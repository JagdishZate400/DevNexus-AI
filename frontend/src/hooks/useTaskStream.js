import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react'
import {taskCollaborationApi} from '../services/taskCollaborationApi'
import {mergeCollaboration,validateCollaborationPage,validateCursor} from '../data/taskCollaboration'
export function useTaskStream(token,taskId,stream,active,onDenied){
 const [state,setState]=useState({items:[],loaded:false,loading:false,error:'',nextCursor:null})
 const current=useRef(state),alive=useRef(false),busy=useRef(false),generation=useRef(0),controller=useRef(null)
 useLayoutEffect(()=>{current.current=state},[state])
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;busy.current=false;controller.current?.abort()}},[])
 const load=useCallback(async(more=false)=>{
  if(busy.current)return
  const cursor=more?current.current.nextCursor:null
  if(more&&!cursor)return
  busy.current=true;const request=++generation.current;controller.current=new AbortController()
  setState(s=>({...s,loading:true,error:''}))
  try{
   const before=cursor?validateCursor(cursor,taskId,stream):null
   const page=validateCollaborationPage(await taskCollaborationApi.list(token,taskId,stream,cursor,AbortSignal.any([controller.current.signal,AbortSignal.timeout(15000)])),taskId,stream,before)
   if(!alive.current||request!==generation.current)return
   const items=mergeCollaboration(more?current.current.items:[],page[stream],stream)
   setState({items,loaded:true,loading:false,error:'',nextCursor:page.nextCursor})
  }catch(error){
   if(!alive.current||request!==generation.current)return
   if([401,403,404].includes(error.status)){setState({items:[],loaded:false,loading:false,error:'',nextCursor:null});onDenied(error);return}
   setState(s=>({...s,loading:false,error:`Could not load ${stream==='activity'?'activity history':'comments'}. Please retry.`}))
  }finally{if(request===generation.current)busy.current=false}
 },[token,taskId,stream,onDenied])
 useEffect(()=>{if(active&&!current.current.loaded)load()},[active,load])
 const add=useCallback(item=>{const items=mergeCollaboration(current.current.items,[item],stream);setState(s=>({...s,items}))},[stream])
 return {...state,load,add}
}
