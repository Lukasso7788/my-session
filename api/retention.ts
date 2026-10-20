import type {VercelRequest,VercelResponse} from '@vercel/node';
import {createClient} from '@supabase/supabase-js';
import {timingSafeEqual} from 'node:crypto';
import {processRetentionEmails,verifyUnsubscribeToken} from './_lib/retentionDelivery.js';
export const config={maxDuration:300};
const scalar=(value:unknown)=>typeof value==='string'?value:'';
export default async function handler(req:VercelRequest,res:VercelResponse){
  res.setHeader('Cache-Control','no-store');
  const secret=String(process.env.DAILY_SCHEDULE_CRON_SECRET||'');
  const action=scalar(req.query.action);
  const supplied=scalar(req.headers['x-cron-secret']);
  const authorized=secret&&supplied.length===secret.length&&timingSafeEqual(Buffer.from(supplied),Buffer.from(secret));
  if(action!=='unsubscribe'&&!authorized)return res.status(401).json({error:'unauthorized'});
  const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL;
  const service=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!service)return res.status(503).json({error:'retention_database_not_configured'});
  const sb=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    if(action==='unsubscribe'){
      const user=verifyUnsubscribeToken(scalar(req.query.t),secret);
      if(!user)return res.status(400).send('This unsubscribe link is invalid.');
      if(req.method==='GET'){
        res.setHeader('Content-Type','text/html; charset=utf-8');
        res.setHeader('Referrer-Policy','no-referrer');
        return res.status(200).send('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MySession email preferences</title><body style="font-family:Inter,Arial;padding:40px;max-width:520px;margin:auto"><h1>MySession email preferences</h1><p>Stop these session invitations, reminders and weekly recaps?</p><form method="post"><button style="padding:14px 22px;background:#3478eb;color:white;border:0;border-radius:12px">Unsubscribe</button></form></body></html>');
      }
      if(req.method!=='POST')return res.status(405).end();
      const {error}=await sb.from('retention_email_opt_outs').upsert({user_id:user},{onConflict:'user_id'});
      if(error)throw new Error('retention_unsubscribe_failed');
      return res.status(200).send('You have unsubscribed from MySession retention emails.');
    }
    if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
    const result=await processRetentionEmails(sb,{dryRun:action==='dry-run',limit:20});
    console.log('[retention-email]',result);
    return res.status(200).json({ok:true,...result});
  }catch(error){
    const message=error instanceof Error?error.message:'retention_error';
    const safe=/^[a-z0-9_:]+$/i.test(message)?message:'retention_error';
    console.error('[retention-email]',safe);
    return res.status(500).json({ok:false,error:safe});
  }
}
