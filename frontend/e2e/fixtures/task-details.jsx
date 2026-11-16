import React from 'react'
import {createRoot} from 'react-dom/client'
import TaskDetails from '../../src/components/tasks/TaskDetails'
import {useAuthStore} from '../../src/store/authStore'
import '../../src/index.css'
const root=createRoot(document.getElementById('root'))
window.renderDetails=({task,token='details-token',ownerId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'})=>{
 useAuthStore.setState({user:{id:ownerId},token})
 root.render(<TaskDetails task={task} token={token} onClose={()=>root.render(<button>Closed</button>)}/>)
}
