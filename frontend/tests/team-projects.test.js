import test from 'node:test'
import assert from 'node:assert/strict'
import {formatMembershipError,validateTeamProjects} from '../src/data/projectMembers.js'
test('Team discovery validates access, authoritative owner identity and distinct project IDs',()=>{
 const owner={id:'one',name:'Owned',ownerId:'me',access:'owner'},member={id:'two',name:'Member',ownerId:'other',access:'member'}
 assert.deepEqual(validateTeamProjects({projects:[owner,member]},'me'),[owner,member])
 for(const projects of [[owner,owner],[{...owner,access:'member'}],[{...member,access:'owner'}],[{id:'memory',name:'Legacy'}],[{...member,access:'admin'}]])assert.throws(()=>validateTeamProjects({projects},'me'))
})
test('formatMembershipError distinguishes 429 rate-limiting from standard and anti-enumeration errors',()=>{
 const rateLimited=formatMembershipError({status:429,message:'Too many member additions. Try again later.',data:{code:'member_add_rate_limited'}})
 assert.equal(rateLimited.isRateLimit,true)
 assert.ok(rateLimited.message.includes('10 attempts per 15-minute window'))
 assert.ok(!rateLimited.message.includes('Refresh the directory, then retry the action.'))

 const conflict=formatMembershipError({status:409,message:'Member could not be added. Check the registered email and existing project directory.',data:{code:'member_not_added'}})
 assert.equal(conflict.isRateLimit,false)
 assert.equal(conflict.message,'Member could not be added. Check the registered email and existing project directory. Refresh the directory, then retry the action.')

 const serverError=formatMembershipError({status:503,message:'Membership storage unavailable.',data:{code:'membership_storage_unavailable'}})
 assert.equal(serverError.isRateLimit,false)
 assert.equal(serverError.message,'Membership storage unavailable. Refresh the directory, then retry the action.')

 const networkError=formatMembershipError(new Error('Network disconnected'))
 assert.equal(networkError.isRateLimit,false)
 assert.ok(networkError.message.includes('Refresh the directory, then retry the action.'))
})

