import { X } from 'lucide-react'
import { useState } from 'react'

const languages = ['JavaScript', 'TypeScript', 'Python', 'Java', 'C++', 'Other']
const frameworks = ['React', 'Node.js', 'Express', 'FastAPI', 'Django', 'Flask', 'Spring Boot', 'Other']

function CreateProjectModal({ isOpen, onClose, onCreate, isSubmitting = false }) {
  const [form, setForm] = useState({ name: '', description: '', language: '', framework: 'React', visibility: 'Private' })
  const [errors, setErrors] = useState({})

  if (!isOpen) return null

  function closeModal() {
    if (isSubmitting) return
    setForm({ name: '', description: '', language: '', framework: 'React', visibility: 'Private' })
    setErrors({})
    onClose()
  }
  function updateField(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setErrors((current) => ({ ...current, [name]: '' }))
  }
  async function submitForm(event) {
    event.preventDefault()
    const nextErrors = {}
    if (!form.name.trim()) nextErrors.name = 'Project name is required.'
    if (!form.description.trim()) nextErrors.description = 'Description is required.'
    if (!form.language) nextErrors.language = 'Primary language is required.'
    if (!form.visibility) nextErrors.visibility = 'Visibility is required.'
    setErrors(nextErrors)
    if (Object.values(nextErrors).some(Boolean)) return
    await onCreate({
      name: form.name.trim(),
      description: form.description.trim(),
      stack: [form.language, form.framework],
      status: 'Active',
      teamSize: 1,
      updated: 'Just now',
      created: 'Today',
      progress: 0,
    })
    setForm({ name: '', description: '', language: '', framework: 'React', visibility: 'Private' })
    setErrors({})
  }
  const fieldClass = (field) => `w-full rounded-lg border bg-[#121a2e] px-3 py-2.5 text-sm text-[#eef1f8] outline-none focus:border-[#f59e0b] focus:ring-4 focus:ring-[#f59e0b]/10 ${errors[field] ? 'border-[#fbbf24]' : 'border-[#2b3558]'}`

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#05070f]/45 p-4 modal-overlay" role="dialog" aria-modal="true" aria-labelledby="create-project-title"><div className="modal-panel max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#232c4b] bg-[#121a2e] p-6 shadow-2xl sm:p-8"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#fbbf24]">New workspace project</p><h2 id="create-project-title" className="mt-2 text-2xl font-bold tracking-tight text-[#eef1f8]">Create project</h2></div><button type="button" onClick={closeModal} aria-label="Close create project dialog" className="rounded-lg p-2 text-[#8f99b0] hover:bg-[#1a2340]"><X size={19} /></button></div><form onSubmit={submitForm} noValidate className="mt-7 space-y-4"><div><label htmlFor="project-name" className="mb-2 block text-sm font-semibold text-[#dbe2ef]">Project name</label><input id="project-name" name="name" value={form.name} onChange={updateField} className={fieldClass('name')} placeholder="e.g. Developer Portal" />{errors.name && <p className="mt-1.5 text-xs font-medium text-[#f87171]">{errors.name}</p>}</div><div><label htmlFor="project-description" className="mb-2 block text-sm font-semibold text-[#dbe2ef]">Description</label><textarea id="project-description" name="description" value={form.description} onChange={updateField} rows="3" className={fieldClass('description')} placeholder="What are you building?" />{errors.description && <p className="mt-1.5 text-xs font-medium text-[#f87171]">{errors.description}</p>}</div><div className="grid gap-4 sm:grid-cols-2"><div><label htmlFor="project-language" className="mb-2 block text-sm font-semibold text-[#dbe2ef]">Primary language</label><select id="project-language" name="language" value={form.language} onChange={updateField} className={fieldClass('language')}><option value="">Select language</option>{languages.map((language) => <option key={language}>{language}</option>)}</select>{errors.language && <p className="mt-1.5 text-xs font-medium text-[#f87171]">{errors.language}</p>}</div><div><label htmlFor="project-framework" className="mb-2 block text-sm font-semibold text-[#dbe2ef]">Framework</label><select id="project-framework" name="framework" value={form.framework} onChange={updateField} className={fieldClass('framework')}>{frameworks.map((framework) => <option key={framework}>{framework}</option>)}</select></div></div><div><label htmlFor="project-visibility" className="mb-2 block text-sm font-semibold text-[#dbe2ef]">Visibility</label><select id="project-visibility" name="visibility" value={form.visibility} onChange={updateField} className={fieldClass('visibility')}><option>Private</option><option>Team</option></select></div><div className="flex flex-col-reverse gap-3 pt-3 sm:flex-row sm:justify-end"><button type="button" onClick={closeModal} disabled={isSubmitting} className="rounded-lg border border-[#2b3558] px-4 py-2.5 text-sm font-bold text-[#b9c2d6] hover:bg-[#1a2340] disabled:opacity-50">Cancel</button><button type="submit" disabled={isSubmitting} className="rounded-lg bg-[#f59e0b] px-4 py-2.5 text-sm font-bold text-[#231303] hover:bg-[#fbbf24] focus:outline-none focus:ring-4 focus:ring-[#f59e0b]/20 btn-shine disabled:opacity-50">{isSubmitting ? 'Creating…' : 'Create project'}</button></div></form></div></div>
}

export default CreateProjectModal
