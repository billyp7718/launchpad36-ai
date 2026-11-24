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
