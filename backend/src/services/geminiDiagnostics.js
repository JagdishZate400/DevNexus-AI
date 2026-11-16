// Only fixed categories and schema identifiers leave this module. Never return
// provider messages, metadata, arbitrary field names or response body fragments.
const STATUSES = new Set(['INVALID_ARGUMENT','UNAUTHENTICATED','PERMISSION_DENIED','NOT_FOUND','RESOURCE_EXHAUSTED','INTERNAL','UNAVAILABLE','DEADLINE_EXCEEDED','FAILED_PRECONDITION'])
const REASONS = new Set(['API_KEY_INVALID','API_KEY_EXPIRED','API_KEY_SERVICE_BLOCKED','API_KEY_HTTP_REFERRER_BLOCKED','API_KEY_IP_ADDRESS_BLOCKED','SERVICE_DISABLED','BILLING_DISABLED','RATE_LIMIT_EXCEEDED','QUOTA_EXCEEDED','ACCESS_TOKEN_EXPIRED'])
const FIELDS = new Set(['generation_config','generationConfig','response_schema','responseSchema','response_mime_type','responseMimeType','max_output_tokens','maxOutputTokens','temperature','candidate_count','candidateCount','system_instruction','systemInstruction','contents','properties','items','required','type','enum','format','max_items','maxItems','min_items','minItems','claims','section','text','citations','fileId','path','lineStart','lineEnd','quote'])
function sanitizeProviderError(data, httpStatus) {
  const error=data?.error
  if (!error || error.code!==httpStatus || typeof error.status!=='string' || !STATUSES.has(error.status)) return {providerCategory:'unrecognized_error',providerReasons:[],schemaFields:[]}
  const reasons=new Set(),fields=new Set()
  // Examine bounded structured details. A free-form description is never copied.
  for(const detail of Array.isArray(error.details) ? error.details.slice(0,8) : []) {
    if(detail?.['@type']==='type.googleapis.com/google.rpc.ErrorInfo' && REASONS.has(detail.reason))reasons.add(detail.reason)
    if(detail?.['@type']==='type.googleapis.com/google.rpc.BadRequest') {
      for(const violation of Array.isArray(detail.fieldViolations) ? detail.fieldViolations.slice(0,8) : []) {
        if(typeof violation?.field!=='string' || violation.field.length>400)continue
        const tokens=violation.field.replace(/\[[0-9]{1,3}\]/g,'').split('.')
        // Reject the entire field when any token is unknown; arbitrary user data
        // embedded in property names cannot leak even if it contains known words.
        if(tokens.length && tokens.length<=20 && tokens.every(token=>FIELDS.has(token)))fields.add(tokens.join('.'))
      }
    }
  }
  // Fixed classifications only; do not log/expose the inspected message itself.
  const message=typeof error.message==='string' ? error.message.slice(0,4000) : ''
  let category=error.status
  if(reasons.has('API_KEY_INVALID') || reasons.has('API_KEY_EXPIRED'))category='api_key_rejected'
  else if(/schema/i.test(message) && /complex|nesting|nested|too many states|too many (?:properties|constraints)|maximum.*depth/i.test(message))category='schema_complexity'
  else if(/schema/i.test(message) && /invalid|unsupported|not supported|unknown/i.test(message))category='schema_invalid'
  return {providerCategory:category,providerReasons:[...reasons].slice(0,8),schemaFields:[...fields].slice(0,8)}
}
async function inspectProviderError(response) {
  let reader,timer
  const fallback={providerCategory:'diagnostic_unavailable',providerReasons:[],schemaFields:[]}
  try {
    reader=response.body?.getReader()
    if(!reader)return fallback
    const read=async()=>{
      const chunks=[];let bytes=0
      while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>32768)return fallback;chunks.push(Buffer.from(value))}
      let data
      try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return {providerCategory:'non_json_error',providerReasons:[],schemaFields:[]}}
      return sanitizeProviderError(data,response.status)
    }
    return await Promise.race([read(),new Promise(resolve=>{timer=setTimeout(()=>resolve(fallback),150)})])
  }catch{return fallback}
  finally{clearTimeout(timer);try{const result=reader?.cancel();result?.catch(()=>{})}catch{}}
}
module.exports={inspectProviderError,sanitizeProviderError}
