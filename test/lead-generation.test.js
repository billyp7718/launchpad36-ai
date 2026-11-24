import test from 'node:test';
import assert from 'node:assert/strict';
import { directoryTargets, registryTargets } from '../api/_lead-discovery.js';

test('directory excludes sidebar and prosecutor links and collapses repeated listings',()=>{
  const link='<a href="https://example.gov">Town Police Department</a>';
  const rows=directoryTargets(link+'<h1>Links to NJ Police Departments</h1>'+link+link+'<b>Prosecutor'+link);
  assert.equal(rows.length,1);
  assert.equal(rows[0].account_category,'government');
  assert.throws(()=>directoryTargets('<html>temporarily unavailable</html>'));
});

test('county identity distinguishes departments with identical names',()=>{
  const agencies=['Morris','Warren'].map(countyName=>({fullName:'Washington Township Police Department',countyName,countySlug:countyName.toLowerCase(),type:'municipal-pd'}));
  agencies.push({fullName:'County Prosecutor',type:'prosecutor'});
  const targets=registryTargets(agencies);
  assert.equal(targets.length,2);
  assert.notEqual(targets[0].name,targets[1].name);
  assert.match(targets[0].region,/Morris County/);
});

test('a free-form channel query discovers new organizations beyond a prior result',async()=>{
  const {discover}=await import('../api/_lead-discovery.js');
  const previous=process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY='fixture';
  try {
    const query='regional convenience-store distributors in Texas';
    const result=await discover(query,['Existing Distributor'],async (_url,request)=>{
      const input=JSON.parse(JSON.parse(request.body).input);
      assert.equal(input.criteria,query);
      assert.deepEqual(input.already_listed,['Existing Distributor']);
      const source='https://example.org/directory';
      const record={name:'New Distributor',channel:'Convenience distribution',source_url:source,website:'https://example.com',region:'Texas',account_category:'large_corporations'};
      return {ok:true,json:async()=>({output_text:JSON.stringify({targets:[record,{...record,name:'Existing Distributor'},{...record,name:'Uncited',source_url:'https://invalid.example/'}]}),output:[{action:{sources:[{url:source}]}}]})};
    });
    assert.deepEqual(result.targets.map(t=>t.name),['New Distributor']);
    assert.equal(result.targets[0].channel,'Convenience distribution');
  } finally {
    if(previous===undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY=previous;
  }
});
