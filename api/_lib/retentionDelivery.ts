import type { SupabaseClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { renderRetentionEmail, type RetentionKind, type RetentionContent, type SuggestedSession } from './retentionTemplates.js';

export type RetentionCandidate = {user_id:string;email:string;first_name:string;timezone:string;kind:RetentionKind;logical_key:string;payload:Record<string,unknown>};
const appUrl = 'https://mysession.club';
export function unsubscribeToken(userId: string, key: string) {
  if (!key) throw new Error('retention_signing_key_missing');
  return `${userId}.${createHmac('sha256',key).update(`retention-v1:${userId}`).digest('hex')}`;
}
export function verifyUnsubscribeToken(token: string, key: string): string | null {
  if (!key || !/^[a-f0-9-]{36}\.[a-f0-9]{64}$/i.test(token)) return null;
  const userId = token.split('.')[0];
  const expected = unsubscribeToken(userId,key);
  return token.length===expected.length && timingSafeEqual(Buffer.from(token),Buffer.from(expected)) ? userId : null;
}
function plunkBase() {
  const url = new URL(String(process.env.PLUNK_API_URL || ''));
  if (url.protocol !== 'https:') throw new Error('plunk_https_required');
  return url.toString().replace(/\/+$/,'');
}
export async function marketingContactAllows(email: string, fetcher = fetch) {
  let cursor = '';
  for (let page=0;page<10;page++) {
    const query=new URLSearchParams({search:email,limit:'100',...(cursor?{cursor}:{})});
    const response=await fetcher(`${plunkBase()}/contacts?${query}`,{headers:{Authorization:`Bearer ${process.env.PLUNK_SECRET_KEY}`},signal:AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error(`plunk_contact_http_${response.status}`);
    const result=await response.json() as {data?:Array<{email:string;subscribed:boolean;snoozedUntil?:string}>;hasMore?:boolean;cursor?:string};
    const contact=result.data?.find(c=>c.email.toLowerCase()===email.toLowerCase());
    if (contact) return contact.subscribed===true && !(contact.snoozedUntil && new Date(contact.snoozedUntil).getTime()>Date.now());
    if (!result.hasMore) return false;
    if (!result.cursor || result.cursor===cursor) throw new Error('plunk_contact_pagination_invalid');
    cursor=result.cursor;
  }
  throw new Error('plunk_contact_lookup_incomplete');
}
export async function sendRetentionViaPlunk(params:{to:string;subject:string;html:string;key:string;unsubscribe:string},fetcher=fetch) {
  const response=await fetcher(`${plunkBase()}/v1/send`,{
    method:'POST',headers:{Authorization:`Bearer ${process.env.PLUNK_SECRET_KEY}`,'Content-Type':'application/json','Idempotency-Key':params.key},
    signal:AbortSignal.timeout(15000),
    body:JSON.stringify({to:params.to,from:{name:process.env.PLUNK_FROM_NAME,email:process.env.PLUNK_FROM_EMAIL},subject:params.subject,body:params.html,
      headers:{'List-Unsubscribe':`<${params.unsubscribe}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click','X-MySession-Email-Type':'retention'}}),
  });
  const body=await response.json().catch(()=>null) as {success?:boolean;error?:{code?:string;details?:{originalRequest?:string;originalStatusCode?:number}};data?:{emails?:Array<{email?:string}>}}|null;
  if (response.status===409 && body?.error?.code==='IDEMPOTENCY_KEY_REUSED' && body.error.details?.originalRequest==='POST /v1/send' && body.error.details.originalStatusCode===200) return null;
  if (!response.ok || body?.success!==true) throw new Error(`plunk_retention_http_${response.status}`);
  return body.data?.emails?.[0]?.email || null;
}
async function suggestions(sb: SupabaseClient):Promise<SuggestedSession[]> {
  const {data,error}=await sb.from('sessions').select('id,title,host_name,start_time,duration_minutes,slug,custom_slug,status,max_participants,participants_count')
    .eq('is_infinite',false).eq('is_private',false).eq('is_hidden',false)
    .not('status','in','(cancelled,closed,ended)').gt('start_time',new Date().toISOString())
    .lt('start_time',new Date(Date.now()+3*86400000).toISOString()).order('start_time').limit(20);
  if(error)throw new Error(`retention_sessions_load:${error.code}`);
  return (data||[]).filter(s=>!s.max_participants||Number(s.participants_count||0)<Number(s.max_participants)).slice(0,3).map(s=>({
    title:s.title,host:s.host_name||'MySession',startsAt:s.start_time,duration:s.duration_minutes||60,
    url:`${appUrl}/${encodeURIComponent(s.custom_slug||s.slug||s.id)}`,
  }));
}
export async function processRetentionEmails(sb:SupabaseClient,{dryRun=false,limit=20}:{dryRun?:boolean;limit?:number}={}) {
  const {data:config,error:configError}=await sb.from('retention_email_config').select('enabled').eq('id',true).single();
  if(configError)throw new Error(`retention_config:${configError.code}`);
  if(!dryRun&&!config?.enabled)return{enabled:false,eligible:0,accepted:0,skipped:0,failed:0};
  const {data,error}=await sb.rpc('retention_email_candidates');
  if(error)throw new Error(`retention_candidates:${error.code}`);
  const candidates=(data||[]) as RetentionCandidate[];
  if(dryRun)return{enabled:!!config?.enabled,eligible:candidates.length,byKind:Object.fromEntries([...new Set(candidates.map(c=>c.kind))].map(k=>[k,candidates.filter(c=>c.kind===k).length]))};
  for(const name of ['PLUNK_API_URL','PLUNK_SECRET_KEY','PLUNK_FROM_EMAIL','PLUNK_FROM_NAME','DAILY_SCHEDULE_CRON_SECRET']) if(!process.env[name])throw new Error(`missing_retention_env:${name}`);
  const sessionOptions=await suggestions(sb);
  let accepted=0,skipped=0,failed=0,processed=0;
  const deadline=Date.now()+220_000;
  const seen=new Set<string>();
  for(const candidate of candidates) {
    if(processed>=Math.max(1,Math.min(30,limit))||Date.now()>deadline)break;
    if(seen.has(candidate.user_id))continue;
    seen.add(candidate.user_id);
    if(candidate.kind!=='booking_reminder'){
      const hour=Number(new Intl.DateTimeFormat('en',{timeZone:candidate.timezone,hour:'2-digit',hourCycle:'h23'}).format(new Date()));
      if(hour<9||hour>=18){skipped++;continue;}
    }
    const {data:claims,error:claimError}=await sb.rpc('claim_retention_email',{p_user:candidate.user_id,p_key:candidate.logical_key});
    if(claimError)throw new Error(`retention_claim:${claimError.code}`);
    const row=claims?.[0];
    if(!row){skipped++;continue;}
    processed++;
    let attempted=false;
    try {
      // A contact-level unsubscribe/snooze is authoritative for marketing.
      if(candidate.kind!=='booking_reminder'&&!await marketingContactAllows(candidate.email)){
        await finish('cancelled','provider_contact_unsubscribed_or_snoozed');skipped++;continue;
      }
      // Re-check activity/booking/preferences after claiming, before contacting provider.
      const {data:current,error:recheckError}=await sb.rpc('retention_email_candidates',{p_user:candidate.user_id});
      if(recheckError)throw new Error(`retention_recheck:${recheckError.code}`);
      const fresh=(current||[]).find((c:RetentionCandidate)=>c.logical_key===candidate.logical_key) as RetentionCandidate|undefined;
      if(!fresh){await finish('cancelled','eligibility_changed');skipped++;continue;}
      const unsubscribe=`${appUrl}/api/retention?action=unsubscribe&t=${encodeURIComponent(unsubscribeToken(candidate.user_id,String(process.env.DAILY_SCHEDULE_CRON_SECRET)))}`;
      const content:RetentionContent={...fresh.payload,firstName:fresh.first_name,timezone:fresh.timezone,sessions:sessionOptions,unsubscribeUrl:unsubscribe};
      const message=renderRetentionEmail(fresh.kind,content);
      const {error:attemptError}=await sb.from('retention_email_sends').update({first_attempt_at:new Date().toISOString()}).eq('id',row.id).eq('status','processing');
      if(attemptError)throw new Error('retention_attempt_record_failed');
      attempted=true;
      const providerId=await sendRetentionViaPlunk({to:fresh.email,subject:message.subject,html:message.html,key:`retention:${row.id}`,unsubscribe});
      const {error:finishError}=await sb.from('retention_email_sends').update({status:'accepted',sent_at:new Date().toISOString(),provider_id:providerId,last_error:null}).eq('id',row.id).eq('status','processing');
      if(finishError)throw new Error('retention_acceptance_record_failed');
      accepted++;
    } catch(error) {
      failed++;
      // Once HTTP may have started, do not risk duplicate email after an unknown outcome.
      const message=String(error instanceof Error?error.message:'retention_failed');
      await finish(attempted?'uncertain':'failed',/^(retention_[a-z_:]+|plunk_retention_http_\d+)$/.test(message)?message:'retention_delivery_failed');
    }
    async function finish(status:string,last_error:string){
      const {error}=await sb.from('retention_email_sends').update({status,last_error}).eq('id',row.id).eq('status','processing');
      if(error)throw new Error('retention_status_record_failed');
    }
  }
  return{enabled:true,eligible:candidates.length,accepted,skipped,failed};
}
