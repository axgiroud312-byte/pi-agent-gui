import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWindowHostControllerProjection } from './windowHostControllerProjection.js';

test('native controller exposes Pi-only sessions without a legacy task and removes them on index removal', () => {
  let ordinal = 0;
  const projection = createWindowHostControllerProjection({ createId: () => String(++ordinal) });
  const scope = { kind: 'local' as const, workspacePath: 'C:\\pi-native-workspace' };
  projection.registerSource({ scope, mutate: () => { throw new Error('Legacy task mutation must not run'); } });
  projection.replaceSourceSnapshot({ scope, taskIndex: [], sessionsIndex: [] });
  const overlay = {
    taskId: '96951d0a-977b-409b-8e67-cb38396ccce4',
    title: 'a Pi user prompt', createdAt: 100, updatedAt: 200,
    liveStatus: 'completed' as const,
  };
  projection.replaceSourceSessionOverlays(scope, [overlay]);
  const [row] = projection.getTasks();
  assert.equal(row?.meta.title, 'a Pi user prompt');
  assert.equal(row?.meta.workspacePath, scope.workspacePath);
  assert.equal(row?.meta.createdAt, 100);
  assert.equal(row?.membership.active, true);
  assert.equal(projection.hasTaskMembership(scope, overlay.taskId), false);
  projection.replaceSourceSessionOverlays(scope, []);
  assert.deepEqual(projection.getTasks(), []);
  projection.replaceSourceSnapshot({ scope, taskIndex: [], sessionsIndex: [overlay] });
  assert.equal(projection.getTasks().length, 1, 'a cold sessions-index snapshot restores the task row');
});
