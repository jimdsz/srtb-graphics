import test from 'node:test';
import assert from 'node:assert/strict';
import {savedVersionMessage,validationAction,validationViews} from '../src/studio/validation-workflow';

test('Les vues portent sur la version actuelle, sans brouillon ni faux compteur',()=>{
  assert.deepEqual(validationViews.map(view=>view.status),['submitted','rejected','approved']);
  assert.deepEqual(validationViews.map(view=>view.label),['En attente','À corriger','Validés']);
  assert.equal(validationViews.every(view=>view.emptyTitle&&view.emptyDescription),true);
});

test('Les actions de relecture sont adaptées au rôle et à l’état',()=>{
  assert.deepEqual(validationViews.map(view=>validationAction(view.status,true)),['Vérifier','Voir','Ouvrir']);
  assert.deepEqual(validationViews.map(view=>validationAction(view.status,false)),['Voir','Corriger','Ouvrir']);
});

test('Une correction sauvegardée n’est pas présentée comme validée ou envoyée',()=>{
  assert.equal(savedVersionMessage('rejected'),'Corrections enregistrées. Soumettez cette nouvelle version au diffuseur.');
  for(const status of ['draft','submitted','approved'] as const)assert.equal(savedVersionMessage(status),'Projet enregistré. Une nouvelle révision a été créée.');
});
