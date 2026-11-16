import {UserRound} from 'lucide-react'

export default function TaskAssignee({task}){
 return <p className="mt-2 flex items-start gap-2 text-xs text-[#b9c2d6]"><UserRound size={14} aria-hidden="true" className="mt-0.5 shrink-0"/><span className="min-w-0 break-words">{task.assignee ? <>Assignee: <span className="font-semibold text-[#eef1f8]">{task.assignee.displayName}</span><span className="block text-[#8f99b0]">{task.assignee.email}</span></> : 'Assignee: Unassigned'}</span></p>
}
