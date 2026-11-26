import test from 'node:test';
import assert from 'node:assert/strict';
import { savePrejoinTask } from '../src/lib/prejoinTask.mjs';
function database(rows=[],failRead=false,failWrite=false) {
  return { rows, writes:0, from(table) {
    assert.equal(table,'panel_intentions');
    return {select(){return {eq(field,user){assert.equal(field,'user_id');assert.equal(user,'self');return {order:async()=>({data:rows,error:failRead?new Error('read failed'):null})}}}},
      upsert(payload){return {select(){return {single:async()=>{if(failWrite)return {data:null,error:new Error('write failed')}; const i=rows.findIndex(r=>r.id===payload.id); if(i>=0) rows[i]=payload;else rows.push(payload);return {data:payload,error:null}}}}}}};
  }};
}
test('prejoin task persists public and first, retry uses same id without duplication',async()=>{
 const db=database([{id:'old',sort_order:-4}]);
 const first=await savePrejoinTask(db,{userId:'self',taskId:'draft',text:'  Finish report  '});
 assert.equal(first.task.sort_order,-5);assert.equal(first.task.text,'Finish report');assert.equal(first.task.visibility,'public');assert.equal(first.task.completed,false);assert.deepEqual(first.order,['draft','old']);
 await savePrejoinTask(db,{userId:'self',taskId:'draft',text:'Finish report revised'});
 assert.equal(db.rows.length,2);assert.equal(db.rows.find(r=>r.id==='draft').text,'Finish report revised');
});
test('empty draft creates nothing',async()=>assert.equal(await savePrejoinTask(null,{text:' '}),null));
test('read or write failures propagate, so join cannot claim successful save',async()=>{
 for(const db of [database([],true),database([],false,true)]) await assert.rejects(savePrejoinTask(db,{userId:'self',taskId:'draft',text:'Work'}));
});
