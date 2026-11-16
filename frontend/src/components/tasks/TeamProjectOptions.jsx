export default function TeamProjectOptions({projects=[]}){
 return <>{[['owner','Owned Projects'],['member','Member Projects']].map(([access,label])=><optgroup key={access} label={label}>{projects.filter(p=>p.access===access).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>)}</>
}
