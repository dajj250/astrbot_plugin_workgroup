// 真实执行结束不能自动提升为验收通过；同名 ID 按来源区分。
const assert = require('node:assert/strict');
const {phase, records} = require('../views/workgroup/team-board.js');
for (const status of ['超时', '受阻', '中断', 'failed', 'BLOCKED']) assert.equal(phase(status, true), 'blocked');
for (const status of ['已执行，待验收', 'done', 'success']) assert.equal(phase(status, true), 'review');
assert.equal(phase('执行中', true), 'running');
assert.equal(phase('unknown'), 'waiting');
const rows = records({self_bot_id:'one', tasks:[{id:'same',status:'done'}]}, {native_execution:{runs:[{id:'same',bot_id:'two',status:'已执行，待验收',files:0}]}});
assert.equal(rows[0].phase, 'review');
assert.equal(rows[0].bot, 'two');
assert.equal(rows[1].phase, 'done');
assert.notEqual(rows[0].key, rows[1].key);
assert.deepEqual(records({}, {}), []);
console.log('PASS: state boundaries, identities, empty data');
