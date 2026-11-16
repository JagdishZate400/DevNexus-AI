import {useCallback,useEffect,useRef,useState} from 'react'
import {Clock3,MessageSquare,Send,X} from 'lucide-react'
import {useAuthStore} from '../../store/authStore'
import {taskCollaborationApi} from '../../services/taskCollaborationApi'
import {activityDescription,commentInput,normalizeComment,validateComment} from '../../data/taskCollaboration'
import {useTaskStream} from '../../hooks/useTaskStream'
import TaskAssignee from './TaskAssignee'

// Only pending user submission metadata, never fetched data or an offline fallback.
const drafts=new Map()
useAuthStore.subscribe((state,previous)=>{if(state.user?.id!==previous.user?.id)drafts.clear()})
const button='rounded-lg border border-[#354368] px-3 py-2 text-sm font-semibold text-[#6ee7b7] outline-none focus-visible:ring-2 focus-visible:ring-[#fbbf24] disabled:opacity-50'
function Timestamp({value}){return <time dateTime={value} title={value}>{new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}</time>}
function FeedState({feed,label}){return <>{feed.loading&&<p role="status" className="py-4 text-sm text-[#b9c2d6]">Loading {label}…</p>}{feed.error&&<div className="my-4 rounded-lg border border-red-400/30 bg-red-400/5 p-3"><p role="alert" className="text-sm text-red-300">{feed.error}</p><button className={`${button} mt-3`} onClick={()=>feed.load(feed.loaded)}>Retry {label}</button></div>}</>}
export default function TaskDetails(props){
 const ownerId=useAuthStore(s=>s.user?.id)
 return <TaskDetailsSession key={`${ownerId}:${props.token}:${props.task.projectId}:${props.task.id}`} {...props}/>
}
function TaskDetailsSession({task,token,onClose}){
 const ownerId=useAuthStore(s=>s.user?.id),draftKey=`${ownerId}:${task.projectId}:${task.id}`
 const [tab,setTab]=useState('comments'),[denied,setDenied]=useState(''),[pending,setPending]=useState(()=>drafts.get(draftKey)||null)
 const [body,setBody]=useState(()=>drafts.get(draftKey)?.body||''),[posting,setPosting]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[touched,setTouched]=useState(false)
 const dialog=useRef(null),tabRefs=useRef({}),alive=useRef(false),inFlight=useRef(false),postController=useRef(null),accessDenied=useRef(false)
 const deny=useCallback(()=>{accessDenied.current=true;postController.current?.abort();setDenied('This task is unavailable or you no longer have permission to view its comments and history.');},[])
 const comments=useTaskStream(token,task.id,'comments',tab==='comments'&&!denied,deny)
 const activity=useTaskStream(token,task.id,'activity',tab==='activity'&&!denied,deny)
 useEffect(()=>{
  alive.current=true;const opener=document.activeElement,node=dialog.current,overflow=document.body.style.overflow
  node.showModal();document.body.style.overflow='hidden';tabRefs.current.comments?.focus()
  return()=>{alive.current=false;postController.current?.abort();node.close();document.body.style.overflow=overflow;if(opener?.isConnected)opener.focus()}
 },[])
 const validation=commentInput(body),remaining=4000-Array.from(normalizeComment(body)).length
 async function submit(event){
  event.preventDefault();if(inFlight.current||denied)return
  setTouched(true);if(validation)return
  const submission=pending||{body:normalizeComment(body),clientRequestId:crypto.randomUUID()}
  drafts.set(draftKey,submission);setPending(submission);inFlight.current=true;setPosting(true);setError('');setNotice('')
  postController.current=new AbortController()
  try{
   const result=await taskCollaborationApi.create(token,task.id,submission,AbortSignal.any([postController.current.signal,AbortSignal.timeout(15000)]))
   const comment=validateComment(result?.comment,task.id)
   if(Object.keys(result).join(',')!=='comment'||comment.clientRequestId!==submission.clientRequestId||comment.body!==submission.body||comment.author.userId!==ownerId)throw Error('Unconfirmed comment')
   if(drafts.get(draftKey)===submission)drafts.delete(draftKey)
   if(!alive.current||accessDenied.current)return
   comments.add(comment);setPending(null);setBody('');setTouched(false);setNotice('Comment saved.')
  }catch(err){
   if(!alive.current)return
   if([401,403,404].includes(err.status)){deny();return}
   setError(err.status===409?'This request ID conflicts with an existing comment. Review the comments before discarding this draft.':'Comment was not confirmed. It may have been saved. Retry this submission with the same request ID.')
  }finally{inFlight.current=false;if(alive.current)setPosting(false)}
 }
 function choose(value,focus=false){setTab(value);if(focus)tabRefs.current[value]?.focus()}
 function tabKey(event){const values=['comments','activity'],index=values.indexOf(tab);let next
  if(event.key==='ArrowRight'||event.key==='ArrowLeft')next=values[1-index]
  if(event.key==='Home')next=values[0];if(event.key==='End')next=values[1]
  if(next){event.preventDefault();choose(next,true)}
 }
 function trapFocus(event){
  if(event.key!=='Tab')return
  const controls=[...dialog.current.querySelectorAll('button:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(node=>node.getClientRects().length)
  const first=controls[0],last=controls.at(-1)
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
 }
 return <dialog onKeyDown={trapFocus} ref={dialog} aria-labelledby="task-details-title" onCancel={event=>{event.preventDefault();onClose()}} className="m-auto max-h-[92dvh] w-[calc(100%_-_1rem)] max-w-3xl overflow-hidden rounded-2xl border border-[#354368] bg-[#0e1529] p-0 text-[#eef1f8] shadow-2xl backdrop:bg-[#030712]/80">
  <div className="flex max-h-[92dvh] flex-col"><header className="shrink-0 border-b border-[#2b3558] p-4 sm:p-6"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#fbbf24]">Task details</p><h2 id="task-details-title" className="mt-2 break-words text-xl font-bold sm:text-2xl">{task.title}</h2><p className="mt-2 text-sm text-[#b9c2d6]">{task.status} <span aria-hidden="true">·</span> {task.priority} priority</p><TaskAssignee task={task}/></div><button onClick={onClose} aria-label="Close task details" className={button}><X size={18}/></button></div></header>
   {denied?<div className="p-6"><p role="alert" className="text-red-300">{denied}</p><button className={`${button} mt-4`} onClick={onClose}>Close details</button></div>:<>
    <div role="tablist" aria-label="Task collaboration" className="flex shrink-0 gap-1 border-b border-[#2b3558] px-4 pt-2 sm:px-6">{[['comments','Comments',MessageSquare],['activity','Activity History',Clock3]].map(([key,label,Icon])=><button key={key} ref={node=>{tabRefs.current[key]=node}} role="tab" id={`task-${key}-tab`} aria-controls={`task-${key}-panel`} aria-selected={tab===key} tabIndex={tab===key?0:-1} onKeyDown={tabKey} onClick={()=>choose(key)} className={`inline-flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#fbbf24] ${tab===key?'border-[#fbbf24] text-[#fbbf24]':'border-transparent text-[#b9c2d6]'}`}><Icon size={16}/>{label}</button>)}</div>
    <div className="min-h-0 overflow-y-auto p-4 sm:p-6">
     <section role="tabpanel" id="task-comments-panel" aria-labelledby="task-comments-tab" tabIndex={0} hidden={tab!=='comments'}>
      <FeedState feed={comments} label="comments"/>
      {comments.loaded&&<><form onSubmit={submit} className="mb-6 rounded-xl border border-[#2b3558] bg-[#151e35] p-4"><label htmlFor="task-comment-body" className="block text-sm font-semibold">Add a comment</label><p id="comment-help" className="mt-1 text-xs text-[#a7b2c8]">Plain text only. Visible to the current project owner.</p><textarea id="task-comment-body" rows={4} value={body} readOnly={!!pending} disabled={posting} aria-describedby="comment-help comment-count comment-validation" aria-invalid={touched&&!!validation} onChange={event=>{setBody(event.target.value);setTouched(true);setError('');setNotice('')}} className="mt-3 w-full resize-y rounded-lg border border-[#455375] bg-[#0b1224] p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#fbbf24] disabled:opacity-60"/><p id="comment-count" className={`mt-1 text-xs ${remaining<0?'text-red-300':'text-[#a7b2c8]'}`}>{remaining.toLocaleString()} characters remaining</p><p id="comment-validation" className="mt-1 text-sm text-red-300">{touched&&validation}</p>
       {pending&&!posting&&<p className="mt-3 text-xs text-[#fbbf24]">This draft keeps its request ID until confirmed. Retry it before starting a different comment.</p>}{error&&<p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}{notice&&<p role="status" className="mt-3 text-sm text-[#6ee7b7]">{notice}</p>}
       <div className="mt-3 flex flex-wrap gap-3"><button type="submit" disabled={posting||!!validation} className={`${button} inline-flex items-center gap-2 bg-[#233c39]`}><Send size={15}/>{posting?'Submitting…':pending?'Retry submission':'Post comment'}</button>{pending&&!posting&&<button type="button" className={button} onClick={()=>{drafts.delete(draftKey);setPending(null);setBody('');setError('');setTouched(false);setNotice('Draft discarded. A previously saved comment may still appear in the list.')}}>Discard pending draft</button>}</div>
      </form><h3 className="mb-3 text-sm font-bold">Comments <span className="font-normal text-[#a7b2c8]">· Newest first</span></h3>{!comments.items.length&&<p className="rounded-xl border border-dashed border-[#354368] p-6 text-sm text-[#a7b2c8]">No comments yet. Start the conversation with a note.</p>}<ol className="space-y-3">{comments.items.map(comment=><li key={comment.id} className="rounded-xl border border-[#2b3558] bg-[#121b30] p-4"><div className="flex flex-wrap items-baseline justify-between gap-2"><p className="break-words text-sm font-semibold">{comment.author.displayName}{comment.author.userId===null&&<span className="ml-2 text-xs font-normal text-[#a7b2c8]">Historical author</span>}</p><span className="text-xs text-[#a7b2c8]"><Timestamp value={comment.createdAt}/></span></div><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-[#dbe2ef]">{comment.body}</p></li>)}</ol>{comments.nextCursor&&!comments.error&&<button className={`${button} mt-4`} disabled={comments.loading} onClick={()=>comments.load(true)}>Load more comments</button>}</>}
     </section>
     <section role="tabpanel" id="task-activity-panel" aria-labelledby="task-activity-tab" tabIndex={0} hidden={tab!=='activity'}><FeedState feed={activity} label="activity history"/>{activity.loaded&&<>{!activity.items.length&&<p className="rounded-xl border border-dashed border-[#354368] p-6 text-sm text-[#a7b2c8]">No recorded activity. Tracking may have started after this task was created.</p>}<ol className="space-y-3">{activity.items.map(event=><li key={event.id} className="rounded-xl border border-[#2b3558] bg-[#121b30] p-4"><div className="flex flex-wrap items-baseline justify-between gap-2"><p className="break-words text-sm font-semibold">{event.actor?event.actor.displayName:'System'} <span className="font-normal text-[#a7b2c8]">· {event.actor?(event.actor.userId===null?'Historical user':'Registered user'):'Database operation'}</span></p><span className="text-xs text-[#a7b2c8]"><Timestamp value={event.occurredAt}/></span></div><p className="mt-3 break-words text-sm leading-relaxed text-[#dbe2ef]">{activityDescription(event)}</p><p className="mt-2 text-xs text-[#a7b2c8]">{event.origin==='api'?'Authenticated action':'Database action'}</p></li>)}</ol>{activity.nextCursor&&!activity.error&&<button className={`${button} mt-4`} disabled={activity.loading} onClick={()=>activity.load(true)}>Load more activity</button>}</>}</section>
    </div>
   </>}
  </div>
 </dialog>
}
