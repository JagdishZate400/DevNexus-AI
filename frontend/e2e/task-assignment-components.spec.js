import {test,expect} from '@playwright/test'
const ownerId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',memberId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const owner={userId:ownerId,displayName:'Owner',email:'owner@test'}
const member={id:'membership',projectId:'owned',userId:memberId,displayName:'Member',email:'member@test',displayRole:'Viewer'}
const props={token:'component-token',ownerId,projectId:'owned',projects:[{id:'owned',name:'Owned'},{id:'other',name:'Other'}]}
async function mount(page,overrides={}){
 await page.route('**/api/project-members?*',route=>route.fulfill({json:{projectId:'owned',owner,members:[member],total:1,limit:20,offset:0}}))
 await page.goto('/e2e/fixtures/task-form.html');await page.waitForFunction(()=>window.renderTaskForm)
 await page.evaluate(props=>window.renderTaskForm(props),{...props,...overrides})
}
test('component task form selects UUID, traps focus and prevents forged identity payloads',async({page})=>{
 await mount(page)
 await expect(page.getByLabel('Title',{exact:true})).toBeFocused()
 await page.getByLabel('Title',{exact:true}).fill('Component assignment')
 await expect(page.getByLabel('Assignee',{exact:true})).toBeEnabled()
 await page.getByLabel('Assignee',{exact:true}).selectOption(memberId)
 await page.getByRole('button',{name:'Create task',exact:true}).focus();await page.keyboard.press('Tab')
 await expect(page.getByRole('button',{name:'Close task dialog'})).toBeFocused()
 await page.getByRole('button',{name:'Create task',exact:true}).click()
 await expect.poll(()=>page.evaluate(()=>window.savedTaskForm)).toEqual({projectId:'owned',payload:{title:'Component assignment',description:'',priority:'Medium',assigneeUserId:memberId}})
})
test('component edit omits unchanged assignment and explicitly clears with null',async({page})=>{
 const task={id:'task',projectId:'owned',title:'Existing',description:'Body',priority:'High',assigneeUserId:memberId,assignee:{userId:memberId,displayName:'Member',email:'member@test'}}
 await mount(page,{task});await expect(page.getByLabel('Assignee',{exact:true})).toBeEnabled()
 await page.getByRole('button',{name:'Save changes'}).click()
 await expect.poll(()=>page.evaluate(()=>window.savedTaskForm?.payload)).toEqual({title:'Existing',description:'Body',priority:'High'})
 await page.getByLabel('Assignee',{exact:true}).selectOption('');await page.getByRole('button',{name:'Save changes'}).click()
 await expect.poll(()=>page.evaluate(()=>window.savedTaskForm?.payload.assigneeUserId)).toBe(null)
})
test('component missing current assignee can preserve or clear without inventing a member',async({page})=>{
 await mount(page,{task:{id:'task',projectId:'owned',title:'Existing',priority:'Medium',assigneeUserId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',assignee:{userId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',displayName:'Former member',email:'former@test'}}})
 await expect(page.getByText(/current selection is not in the loaded directory/)).toBeVisible()
 await page.getByRole('button',{name:'Save changes'}).click()
 expect(await page.evaluate(()=>Object.hasOwn(window.savedTaskForm.payload,'assigneeUserId'))).toBe(false)
 await page.getByLabel('Assignee',{exact:true}).selectOption('');await page.getByRole('button',{name:'Save changes'}).click()
 await expect.poll(()=>page.evaluate(()=>window.savedTaskForm?.payload.assigneeUserId)).toBe(null)
})
test('component ignores late directory responses from a previous authenticated account',async({page})=>{
 await mount(page)
 const nextOwner='dddddddd-dddd-4ddd-8ddd-dddddddddddd';let release
 await page.route('**/api/project-members?*',async route=>{
  if(route.request().headers().authorization==='Bearer old-token'){
   await new Promise(resolve=>{release=resolve});await route.fulfill({json:{projectId:'owned',owner,members:[member],total:1,limit:20,offset:0}}).catch(()=>{})
  }else await route.fulfill({json:{projectId:'owned',owner:{userId:nextOwner,displayName:'Next owner',email:'next@test'},members:[],total:0,limit:20,offset:0}})
 })
 await page.evaluate(props=>window.renderTaskForm(props),{...props,token:'old-token',sessionKey:'old'})
 await expect.poll(()=>typeof release).toBe('function')
 await page.evaluate(props=>window.renderTaskForm(props),{...props,token:'next-token',ownerId:nextOwner,sessionKey:'next'})
 await expect(page.getByLabel('Assignee')).toBeEnabled();release()
 await expect(page.getByLabel('Assignee').locator('option')).toHaveText(['Unassigned','Next owner — next@test (Owner)'])
 await expect(page.getByLabel('Assignee')).toHaveValue('')
})
