import {useCallback,useEffect,useRef,useState} from 'react'
import {sprintError} from '../data/projectSprints'
// Each caller is keyed to its account/project/sprint. A new load invalidates old responses.
export function useSprintRequest(request,{refreshOnFocus=true}={}){
 const [state,setState]=useState({data:null,loading:true,error:''}),generation=useRef(0),alive=useRef(true)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 const load=useCallback(async({background=false}={})=>{
  const current=++generation.current
  setState(previous=>({data:background?previous.data:null,loading:true,error:''}))
  try{const data=await request();if(alive.current && current===generation.current)setState({data,loading:false,error:''});return data}
  catch(error){if(alive.current && current===generation.current)setState({data:null,loading:false,error:sprintError(error)})}
 },[request])
 // Loading state accompanies the external API request, rather than derived UI state.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{load()},[load])
 // Re-read persisted data when returning from Tasks in another tab/window.
 useEffect(()=>{
  if(!refreshOnFocus)return
  const refresh=()=>{if(document.visibilityState==='visible')load({background:true})}
  window.addEventListener('focus',refresh)
  document.addEventListener('visibilitychange',refresh)
  return()=>{window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh)}
 },[load,refreshOnFocus])
 return {...state,load}
}
