import assert from 'node:assert/strict';
import {test,afterEach} from 'node:test';
import {build} from 'esbuild';
import {RETENTION_KINDS,renderRetentionEmail} from './retentionTemplates.ts';
const bundle=await build({entryPoints:['api/_lib/retentionDelivery.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {unsubscribeToken,verifyUnsubscribeToken,marketingContactAllows,sendRetentionViaPlunk,processRetentionEmails}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});
for(const name of ['PLUNK_API_URL','PLUNK_SECRET_KEY','PLUNK_FROM_EMAIL','PLUNK_FROM_NAME','DAILY_SCHEDULE_CRON_SECRET'])process.env[name]=name==='PLUNK_API_URL'?'https://mail.example.test':'test-only';
test('all seven production templates render without placeholders; user text is escaped',()=>{
  for(const kind of RETENTION_KINDS){
    const message=renderRetentionEmail(kind,{firstName:'<script>alert(1)</script>',timezone:'invalid',sessionCount:2,minutes:91,unsubscribeUrl:'https://mysession.club/settings'});
    assert.ok(message.subject&&message.html&&message.text);
    assert.doesNotMatch(message.html,/<script>|\{\{/);
    assert.match(message.html,/&lt;script&gt;/);
    assert.match(message.html,/Unsubscribe/);
  }
  assert.throws(()=>renderRetentionEmail('first_session',{unsubscribeUrl:'https://evil.example/'}),/invalid_retention_link/);
});
test('unsubscribe tokens bind to the user and server secret',()=>{
  const id='12345678-1234-1234-1234-123456789abc';
  const token=unsubscribeToken(id,'one');
  assert.equal(verifyUnsubscribeToken(token,'one'),id);
  assert.equal(verifyUnsubscribeToken(token,'two'),null);
  assert.equal(verifyUnsubscribeToken(token.replace(id,'22345678-1234-1234-1234-123456789abc'),'one'),null);
});
test('Plunk unsubscribed, absent and snoozed contacts never get marketing or resubscription',async()=>{
  for(const contact of [null,{email:'user@example.test',subscribed:false},{email:'user@example.test',subscribed:true,snoozedUntil:'2099-01-01'}]){
    assert.equal(await marketingContactAllows('user@example.test',async(_url,init)=>{
      assert.equal(init.method,undefined);
      return Response.json({data:contact?[contact]:[],hasMore:false});
    }),false);
  }
});
test('transport sends the exact preview HTML with stable idempotency and one-click unsubscribe',async()=>{
  await sendRetentionViaPlunk({to:'user@example.test',subject:'Subject',html:'<h1>Preview</h1>',key:'stable',unsubscribe:'https://mysession.club/unsubscribe'},async(_url,init)=>{
    assert.equal(init.headers['Idempotency-Key'],'stable');
    const body=JSON.parse(init.body);
    assert.equal(body.body,'<h1>Preview</h1>');
    assert.equal(body.headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');
    return Response.json({success:true});
  });
  await assert.rejects(sendRetentionViaPlunk({to:'x',subject:'s',html:'h',key:'k',unsubscribe:'u'},async()=>Response.json({success:true},{status:500})),/http_500/);
});
function database({enabled=true,current=true}={}){
  const updates=[];
  const candidate={user_id:'fixture',email:'user@example.test',kind:'booking_reminder',logical_key:'reminder:fixture',timezone:'UTC',first_name:'Alex',payload:{sessionTitle:'Test',sessionStart:new Date(Date.now()+900000).toISOString()}};
  let candidateReads=0;
  const sb={
    from(table){return{
      select(){return this;},eq(){return this;},single:async()=>({data:{enabled}}),
      not(){return this;},gt(){return this;},lt(){return this;},order(){return this;},limit:async()=>({data:[]}),
      update(value){updates.push({table,...value});return this;},
      then(resolve){resolve({error:null});},
    };},
    async rpc(name){
      if(name==='retention_email_candidates'){candidateReads++;return{data:candidateReads===1||current?[candidate]:[]};}
      if(name==='claim_retention_email')return{data:[{id:'fixture-send',payload:candidate.payload}]};
      throw new Error('Unexpected RPC');
    },
  };
  return{sb,updates};
}
test('dry run and disabled configuration cannot send',async()=>{
  globalThis.fetch=()=>assert.fail('No email expected');
  assert.equal((await processRetentionEmails(database({enabled:false}).sb)).enabled,false);
  assert.equal((await processRetentionEmails(database().sb,{dryRun:true})).eligible,1);
});
test('eligibility is checked again; a returned/cancelled booking suppresses delivery',async()=>{
  const {sb,updates}=database({current:false});
  globalThis.fetch=()=>assert.fail('No email after eligibility changed');
  const result=await processRetentionEmails(sb);
  assert.equal(result.accepted,0);
  assert.ok(updates.some(u=>u.status==='cancelled'&&u.last_error==='eligibility_changed'));
});
test('accepted and ambiguous results are recorded distinctly',async()=>{
  const good=database();
  globalThis.fetch=async()=>Response.json({success:true});
  assert.equal((await processRetentionEmails(good.sb)).accepted,1);
  assert.ok(good.updates.some(u=>u.status==='accepted'));
  const uncertain=database();
  globalThis.fetch=async()=>{throw new Error('simulated network timeout');};
  assert.equal((await processRetentionEmails(uncertain.sb)).failed,1);
  assert.ok(uncertain.updates.some(u=>u.status==='uncertain'));
});
