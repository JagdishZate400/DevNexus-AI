// Browser component harness, excluded from the production entry point.
import React from 'react'
import {createRoot} from 'react-dom/client'
import '../../src/index.css'
import TaskFormModal from '../../src/components/tasks/TaskFormModal'
const root=createRoot(document.getElementById('root'))
window.renderTaskForm=props=>root.render(<TaskFormModal key={props.sessionKey || 'session'} {...props} onClose={()=>{window.closedTaskForm=true}} onSave={async(payload,projectId)=>{window.savedTaskForm={payload,projectId}}}/>)
