import React from 'react'
import {createRoot} from 'react-dom/client'
import {DocumentationSession} from '../../src/pages/DocumentationPage'
import {DOCUMENTATION_TYPES} from '../../src/data/documentationTypes'
import {generationPayload} from '../../src/data/documentationRequests'
import '../../src/index.css'
// This test page CANNOT contact the real backend: all calls stay in a dedicated
// frontend-only namespace. Without Playwright interception they fail, not fall back.
async function call(path,{body,signal}={}){
  const res=await fetch(`/__documentation_fixture__/${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:signal||AbortSignal.timeout(15000)})
  const data=await res.json()
  if(!res.ok)throw Object.assign(Error(data.message||'Fixture request failed.'),{status:res.status,data})
  return data
}
const api={
  list:(_token,projectId,offset=0,signal)=>call(`documents?projectId=${encodeURIComponent(projectId)}&offset=${offset}`,{signal}),
  get:(_token,id,signal)=>call(`documents/${encodeURIComponent(id)}`,{signal}),
  generate:(_token,operation)=>call('generate',{body:generationPayload(operation),signal:AbortSignal.timeout(150000)}),
  markdown:async()=>{throw Error('Fixture downloads must be explicitly mocked.')},
}
const loadProjects=()=>call('projects')
createRoot(document.getElementById('root')).render(<><p className="bg-amber-100 p-3 font-bold text-black">ISOLATED FIXTURE - no development database access</p><DocumentationSession token="documentation-fixture-session" api={api} loadProjects={loadProjects} acceptedTypes={DOCUMENTATION_TYPES.map(type=>type.id)}/></>)
