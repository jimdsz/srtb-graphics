import {test} from 'node:test';
import assert from 'node:assert/strict';
import {baIntroDays} from '../src/studio/typography-engine';
import {engineData} from '../src/studio/presentation';

test('TV intro retains all distinct appointments in their editorial order',()=>{
  assert.equal(baIntroDays({_jour_1:'Lundi',_jour_2:'Mardi',_jour_3:'Jeudi'}),'LUNDI - MARDI - JEUDI');
  assert.equal(baIntroDays({_jour_1:'Vendredi',_jour_2:' vendredi ',_jour_3:'Samedi'}),'VENDREDI - SAMEDI');
  assert.equal(baIntroDays({_jour_1:'Été',_jour_2:'E\u0301te\u0301',_jour_3:''}),'ÉTÉ');
});
test('engine-facing simple dates hide preserved appointments and multiple restores them',()=>{
  const data={_studio_ba_mode:'simple',_jour_1:'Tout de suite',_heure_1:'',_jour_2:'Mardi',_heure_2:'09h00',_jour_3:'Jeudi',_heure_3:'14h30'};
  assert.equal(baIntroDays(engineData(data)),'TOUT DE SUITE');
  assert.equal(baIntroDays(engineData({...data,_studio_ba_mode:'multiple',_jour_1:'Lundi',_heure_1:'20h30'})),'LUNDI - MARDI - JEUDI');
  assert.equal(data._jour_2,'Mardi');
});
