const {sourceError}=require('./sourceArchive')
const BUG_FOCUSES=Object.freeze({logic_errors:'Logic Errors',null_undefined_handling:'Null / Undefined Handling',input_validation:'Input Validation',error_handling:'Error Handling',incorrect_conditions:'Incorrect Conditions'})
const SECURITY_FOCUSES=Object.freeze({hard_coded_secrets:'Hard-coded Secrets',sql_injection:'SQL Injection',xss:'XSS',authentication_weaknesses:'Authentication Weaknesses',sensitive_data_exposure:'Sensitive Data Exposure',unsafe_input_handling:'Unsafe Input Handling'})
const REVIEW_FOCUSES=Object.freeze(['General','Bugs','Security','Maintainability','BugsAndSecurity'])
function normalizeReviewOptions(options){
 if(options!==undefined && (!options || typeof options!=='object' || Array.isArray(options) || Object.keys(options).some(key=>!['focus','analysisFocus'].includes(key))))throw sourceError('invalid_request','Unsupported review options.')
 const focus=options?.focus===undefined ? 'General' : options.focus
 if(!REVIEW_FOCUSES.includes(focus))throw sourceError('invalid_request','Unsupported review focus.')
 const result={focus},selection=options?.analysisFocus
 if(selection===undefined)return result
 if(!selection || typeof selection!=='object' || Array.isArray(selection) || Object.keys(selection).some(key=>!['bugs','security'].includes(key)))throw sourceError('invalid_request','analysisFocus must contain only bugs and security identifier arrays.')
 const selected={}
 for(const [group,allowed] of [['bugs',BUG_FOCUSES],['security',SECURITY_FOCUSES]]){
  const values=selection[group]===undefined ? [] : selection[group]
  if(!Array.isArray(values) || values.length>Object.keys(allowed).length || values.some(value=>typeof value!=='string' || !Object.hasOwn(allowed,value)) || new Set(values).size!==values.length)throw sourceError('invalid_request','Invalid, duplicate or excessive analysis focus identifiers.')
  selected[group]=[...values].sort()
 }
 if((selected.bugs.length && !['Bugs','BugsAndSecurity'].includes(focus)) || (selected.security.length && !['Security','BugsAndSecurity'].includes(focus)))throw sourceError('invalid_request','Analysis focus identifiers do not match the selected profile.')
 if(selected.bugs.length || selected.security.length)result.analysisFocus=selected
 return result
}
function analysisFocusInstructions(options){
 const selection=options.analysisFocus
 if(!selection)return ''
 const labels=[...selection.bugs.map(id=>BUG_FOCUSES[id]),...selection.security.map(id=>SECURITY_FOCUSES[id])]
 return ` Prioritize these server-allowlisted checks: ${labels.join('; ')}. These are analysis priorities, not evidence of a defect. Retain the selected profile's source-grounded validation and allow zero findings. Do not invent issues to populate selected checks.`
}
module.exports={BUG_FOCUSES,SECURITY_FOCUSES,REVIEW_FOCUSES,normalizeReviewOptions,analysisFocusInstructions}
