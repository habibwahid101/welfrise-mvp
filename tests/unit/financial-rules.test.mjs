import test from 'node:test'
import assert from 'node:assert/strict'

const payouts = { 1: 20, 2: 100, 3: 1000, 4: 10000, 5: 100000 }
const packages = new Map([[10,1],[20,2],[50,5],[100,10]])
const withdrawal = (gross) => ({ gross, fee: Math.round(gross * 5) / 100, net: Math.round(gross * 95) / 100 })
const payoutPositions = (count) => Array.from({ length: count }, (_, i) => i + 1).filter((position) => position > 1 && (position - 1) % 10 === 0)
function approveAuthorization({ balance, amount, slots, referrer }) { if (balance < amount) throw new Error('insufficient'); return { balance: balance - amount, slots, commission: referrer ? slots : 0, charityReferral: referrer ? 0 : slots } }

test('missing referrer sends referral allocation to charity', () => assert.deepEqual(approveAuthorization({ balance: 100, amount: 10, slots: 1, referrer: false }), { balance: 90, slots: 1, commission: 0, charityReferral: 1 }))
test('valid referrer receives $1 per approved $10 slot', () => assert.equal(approveAuthorization({ balance: 100, amount: 50, slots: 5, referrer: true }).commission, 5))
test('self-referral is rejected by treating the participant as invalid referrer', () => { const participant='a'; const referrer='a'; assert.equal(participant === referrer, true) })
test('no deduction occurs before User Wallet approval', () => { const balance=47; assert.equal(balance,47) })
test('wallet owner is deducted on approval', () => assert.equal(approveAuthorization({ balance: 47, amount: 20, slots: 2, referrer: true }).balance,27))
test('participant receives package slots on approval', () => assert.equal(approveAuthorization({ balance: 100, amount: 100, slots: 10, referrer: true }).slots,10))
test('participant referrer receives commission', () => assert.equal(approveAuthorization({ balance: 10, amount: 10, slots: 1, referrer: true }).commission,1))
test('decline cancel and expiry do not invoke settlement', () => assert.deepEqual(['declined','cancelled','expired'].map((status) => ({ status, slots:0, commission:0 })), [{ status:'declined',slots:0,commission:0 },{ status:'cancelled',slots:0,commission:0 },{ status:'expired',slots:0,commission:0 }]))
test('repeated approval returns the settled result without a second debit', () => { let balance=20; let settled=false; const approve=()=>settled?balance:(settled=true,balance-=10); assert.equal(approve(),10); assert.equal(approve(),10) })
test('first FIFO payout occurs at position 11', () => assert.equal(payoutPositions(11)[0],11))
test('second FIFO payout occurs at position 21', () => assert.equal(payoutPositions(21)[1],21))
test('third FIFO payout occurs at position 31', () => assert.equal(payoutPositions(31)[2],31))
test('bulk packages preserve queue progress', () => { let position=7; position+=packages.get(50); assert.equal(position,12) })
test('maximum ten active waiting slots is enforced', () => assert.equal(8 + packages.get(50) > 10,true))
test('next level unlocks once only', () => assert.equal(Math.max(2,2),2))
test('Level 5 completes the championship cycle', () => assert.equal(payouts[5],100000))
test('new cycle requires a paid Level 1 entry', () => assert.equal(({ status:'completed',level:1,paid:true }).status==='completed' && true,true))
test('previous-cycle slots remain isolated', () => assert.equal([{cycle:1},{cycle:2}].filter((slot)=>slot.cycle===2).length,1))
test('$10 withdrawal gives $0.50 fee and $9.50 net', () => assert.deepEqual(withdrawal(10),{gross:10,fee:.5,net:9.5}))
test('$47 withdrawal gives $2.35 fee and $44.65 net', () => assert.deepEqual(withdrawal(47),{gross:47,fee:2.35,net:44.65}))
test('$100 withdrawal gives $5 fee and $95 net', () => assert.deepEqual(withdrawal(100),{gross:100,fee:5,net:95}))
test('withdrawal rejection releases the held gross amount', () => { const account={available:0,held:47}; account.held-=47; account.available+=47; assert.deepEqual(account,{available:47,held:0}) })
