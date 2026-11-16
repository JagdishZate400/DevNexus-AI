const { parse } = require('@babel/parser')
const posix = require('path').posix
const bad = () => { throw Object.assign(new Error('Source analysis rejected.'), { code: 'malformed_source' }) }

function analyzeNonJsSource(file) {
  const imports = []
  const exports = []
  const symbols = []
  const routes = []
  const mounts = []
  const environment = []
  const unresolved = []

  const ref = (lineStart, lineEnd = lineStart) => ({
    fileId: file.id,
    path: file.path,
    hash: file.sha256,
    lineStart,
    lineEnd,
  })

  const lines = file.content ? file.content.split(/\r\n|\n|\r/) : []

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNum = idx + 1
    const rawLine = lines[idx]
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith('//') || line.startsWith('--')) continue

    // 1. Python imports
    const pyFrom = line.match(/^from\s+([a-zA-Z0-9_.]+)\s+import\s+(.+)$/)
    if (pyFrom) {
      imports.push({ specifier: pyFrom[1], reference: ref(lineNum) })
      continue
    }
    const pyImport = line.match(/^import\s+([a-zA-Z0-9_., ]+)$/)
    if (pyImport) {
      for (const mod of pyImport[1].split(',')) {
        const specifier = mod.trim().split(/\s+as\s+/)[0]
        if (specifier) imports.push({ specifier, reference: ref(lineNum) })
      }
      continue
    }

    // 2. Python symbols & routes
    const pyRoute = line.match(/^@([a-zA-Z_][a-zA-Z0-9_]*)\.(get|post|put|delete|patch|options|head)\s*\(\s*["']([^"']+)["']/)
    if (pyRoute) {
      routes.push({
        receiver: pyRoute[1],
        method: pyRoute[2].toUpperCase(),
        path: pyRoute[3],
        reference: ref(lineNum),
        classification: 'static-declaration-not-runtime-verification',
      })
      continue
    }
    const pyDef = line.match(/^def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\):/)
    if (pyDef) {
      const params = pyDef[2].split(',').map((p) => p.trim().split(/[:=]/)[0].trim()).filter(Boolean)
      symbols.push({ name: pyDef[1], kind: 'function', parameters: params, reference: ref(lineNum) })
      continue
    }
    const pyClass = line.match(/^class\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*\(([^)]*)\))?:/)
    if (pyClass) {
      symbols.push({ name: pyClass[1], kind: 'class', reference: ref(lineNum) })
      continue
    }

    // 3. Go imports
    const goImport = line.match(/^import\s+"([^"]+)"$/)
    if (goImport) {
      imports.push({ specifier: goImport[1], reference: ref(lineNum) })
      continue
    }

    // 4. Go symbols
    const goFunc = line.match(/^func\s+(?:\([^)]+\)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/)
    if (goFunc) {
      symbols.push({ name: goFunc[1], kind: 'function', reference: ref(lineNum) })
      if (/^[A-Z]/.test(goFunc[1])) {
        exports.push({ name: goFunc[1], kind: 'function', reference: ref(lineNum) })
      }
      continue
    }
    const goType = line.match(/^type\s+([A-Za-z_][A-Za-z0-9_]*)\s+(struct|interface)/)
    if (goType) {
      symbols.push({ name: goType[1], kind: goType[2], reference: ref(lineNum) })
      if (/^[A-Z]/.test(goType[1])) {
        exports.push({ name: goType[1], kind: goType[2], reference: ref(lineNum) })
      }
      continue
    }

    // 5. Rust imports & symbols
    const rustUse = line.match(/^use\s+([^;]+);$/)
    if (rustUse) {
      imports.push({ specifier: rustUse[1].trim(), reference: ref(lineNum) })
      continue
    }
    const rustFn = line.match(/^(?:pub(?:\([^)]+\))?\s+)?fn\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/)
    if (rustFn) {
      symbols.push({ name: rustFn[1], kind: 'function', reference: ref(lineNum) })
      if (line.startsWith('pub ')) exports.push({ name: rustFn[1], kind: 'function', reference: ref(lineNum) })
      continue
    }
    const rustType = line.match(/^(?:pub(?:\([^)]+\))?\s+)?(struct|enum|trait)\s+([a-zA-Z_][a-zA-Z0-9_]*)/)
    if (rustType) {
      symbols.push({ name: rustType[2], kind: rustType[1], reference: ref(lineNum) })
      if (line.startsWith('pub ')) exports.push({ name: rustType[2], kind: rustType[1], reference: ref(lineNum) })
      continue
    }

    // 6. Java / C# imports & symbols
    const javaImport = line.match(/^(?:import|using)\s+([a-zA-Z0-9_.]+);/)
    if (javaImport) {
      imports.push({ specifier: javaImport[1], reference: ref(lineNum) })
      continue
    }
    const javaClass = line.match(/^(?:public|protected|private|static|\s)*(?:class|interface|record)\s+([A-Za-z_][A-Za-z0-9_]*)/)
    if (javaClass) {
      symbols.push({ name: javaClass[1], kind: 'class', reference: ref(lineNum) })
      continue
    }

    // 7. C / C++ includes
    const cInclude = line.match(/^#include\s+[<"]([^>"]+)[>"]/)
    if (cInclude) {
      imports.push({ specifier: cInclude[1], reference: ref(lineNum) })
      continue
    }

    // 8. SQL DDL
    const sqlTable = line.match(/^CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|PROCEDURE|FUNCTION)\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_.]+)/i)
    if (sqlTable) {
      symbols.push({ name: sqlTable[1], kind: 'schema-object', reference: ref(lineNum) })
      continue
    }

    // 9. Environment variables across languages
    const envMatch = line.match(/(?:os\.environ\.get|os\.getenv|System\.getenv|Environment\.GetEnvironmentVariable|env::var|getenv)\s*\(\s*["']([A-Z][A-Z0-9_]{0,79})["']/)
    if (envMatch) {
      environment.push({ name: envMatch[1], reference: ref(lineNum) })
    }
  }

  return {
    imports,
    exports,
    symbols,
    routes,
    mounts,
    environment,
    unresolved,
    parser: 'multi-language-text-fallback',
    limitations: ['Static pattern analysis without code execution. No code is executed.'],
  }
}

function analyzeSource(file) {
  if (!/\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/i.test(file.path)) {
    return analyzeNonJsSource(file)
  }
  let ast
  try { ast = parse(file.content, { sourceType:'unambiguous', plugins:[...( /\.(?:ts|tsx|mts|cts)$/i.test(file.path) ? ['typescript'] : []), ...(/\.(?:jsx|tsx)$/i.test(file.path) ? ['jsx'] : [])] }) } catch { bad() }
  const imports=[],exports=[],symbols=[],routes=[],mounts=[],environment=[],unresolved=[]
  const bindings=new Map(),expressNames=new Set(),routerNames=new Set(),receivers=new Set(),modules=new Map()
  const str = n => n?.type==='StringLiteral' ? n.value : null
  const id = n => n?.type==='Identifier' ? n.name : null
  const member = n => n?.type==='MemberExpression' && !n.computed ? id(n.property) : null
  const ref = n => ({fileId:file.id,path:file.path,hash:file.sha256,lineStart:n.loc.start.line,lineEnd:n.loc.end.line})
  let shadowedRequire=false
  const requirePath = n => !shadowedRequire && n?.type==='CallExpression' && id(n.callee)==='require' && n.arguments.length===1 ? str(n.arguments[0]) : null
  function patternNames(n) {
    if(!n)return []
    if(n.type==='Identifier')return [n.name]
    if(n.type==='ObjectPattern')return n.properties.flatMap(p=>patternNames(p.value||p.argument))
    if(n.type==='ArrayPattern')return n.elements.flatMap(patternNames)
    if(n.type==='AssignmentPattern')return patternNames(n.left)
    if(n.type==='RestElement')return patternNames(n.argument)
    if(n.type==='TSParameterProperty')return patternNames(n.parameter)
    return []
  }
  let count=0
  const nodes=[]
  function visit(n,depth=0) {
    if (!n || typeof n!=='object') return
    if(depth>150 || ++count>50000) bad()
    if(n.type) nodes.push(n)
    for(const [key,value] of Object.entries(n)) {
      if(['loc','start','end','comments','tokens','extra'].includes(key)) continue
      if(Array.isArray(value)) for(const child of value) visit(child,depth+1)
      else if(value && typeof value==='object') visit(value,depth+1)
    }
  }
  visit(ast.program)
  shadowedRequire=nodes.some(n=>(n.type==='VariableDeclarator'&&patternNames(n.id).includes('require')) || (['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(n.type)&&(id(n.id)==='require'||n.params.flatMap(patternNames).includes('require'))))
  for(const n of nodes) {
    if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(n.type)) for(const name of n.params.flatMap(patternNames)) bindings.set(name,(bindings.get(name)||0)+1)
    if(['FunctionDeclaration','ClassDeclaration'].includes(n.type)&&id(n.id)) bindings.set(id(n.id),(bindings.get(id(n.id))||0)+1)
    if(n.type==='AssignmentExpression'&&id(n.left)) bindings.set(id(n.left),(bindings.get(id(n.left))||0)+1)
    if(n.type==='ImportDeclaration') {
      imports.push({specifier:n.source.value,reference:ref(n)})
      for(const s of n.specifiers) {
        bindings.set(s.local.name,(bindings.get(s.local.name)||0)+1)
        modules.set(s.local.name,n.source.value)
        if(n.source.value==='express') {
          if(s.type==='ImportDefaultSpecifier'||s.type==='ImportNamespaceSpecifier') expressNames.add(s.local.name)
          if(s.imported?.name==='Router') routerNames.add(s.local.name)
        }
      }
    }
    if(n.type==='VariableDeclarator') {
      for(const name of patternNames(n.id)) bindings.set(name,(bindings.get(name)||0)+1)
      const target=requirePath(n.init)
      if(target!==null) {
        imports.push({specifier:target,reference:ref(n)})
        if(id(n.id)) { modules.set(id(n.id),target); if(target==='express') expressNames.add(id(n.id)) }
        if(target==='express' && n.id.type==='ObjectPattern') for(const p of n.id.properties) if(p.key?.name==='Router'&&id(p.value)) routerNames.add(id(p.value))
      }
      if(n.id.type==='ObjectPattern' && id(n.init?.object)==='process' && member(n.init)==='env') for(const p of n.id.properties) {
        const name=p.computed ? str(p.key) : id(p.key)
        if(name && /^[A-Z][A-Z0-9_]{0,79}$/.test(name)) environment.push({name,reference:ref(n)})
        else unresolved.push({kind:'dynamic-environment-name',reference:ref(n)})
      }
    }
    if(n.type.startsWith('Export')) {
      if(n.source) imports.push({specifier:n.source.value,reference:ref(n)})
      if(n.declaration?.type==='VariableDeclaration') {
        for(const declaration of n.declaration.declarations) for(const name of patternNames(declaration.id)) exports.push({name,kind:'binding',reference:ref(n)})
      } else exports.push({name:n.declaration?.id?.name || (n.type==='ExportDefaultDeclaration' ? 'default' : n.specifiers?.map(s=>s.exported?.name).join(',') || (n.type==='ExportAllDeclaration'?'*':'unresolved-export')),kind:n.declaration?.type==='FunctionDeclaration'?'function':n.declaration?.type,local:id(n.declaration),reference:ref(n)})
    }
    if(n.type==='CallExpression'&&(id(n.callee)==='require'||n.callee.type==='Import')) {
      const specifier=n.callee.type==='Import'?str(n.arguments[0]):requirePath(n)
      if(specifier!==null && !imports.some(i=>i.specifier===specifier&&i.reference.lineStart===n.loc.start.line)) imports.push({specifier,dynamicImport:n.callee.type==='Import',reference:ref(n)})
      else if(specifier===null) unresolved.push({kind:'dynamic-or-shadowed-module-reference',reference:ref(n)})
    }
    if(['FunctionDeclaration','ClassDeclaration','TSInterfaceDeclaration','TSTypeAliasDeclaration'].includes(n.type)) symbols.push({name:id(n.id)||'anonymous',kind:n.type==='FunctionDeclaration'?'function':n.type,parameters:n.params?.map(p=>id(p)||'pattern'),reference:ref(n)})
    if(n.type==='VariableDeclarator' && ['ArrowFunctionExpression','FunctionExpression','ClassExpression'].includes(n.init?.type)) symbols.push({name:id(n.id)||'pattern',kind:n.init.type,parameters:n.init.params?.map(p=>id(p)||'pattern'),reference:ref(n)})
    if(n.type==='AssignmentExpression' && ((id(n.left?.object)==='module'&&member(n.left)==='exports') || id(n.left?.object)==='exports')) exports.push({name:member(n.left),local:id(n.right),reference:ref(n)})
    if(n.type==='MemberExpression' && n.object?.type==='MemberExpression' && id(n.object.object)==='process' && member(n.object)==='env') {
      const name=n.computed ? str(n.property) : id(n.property)
      if(name && /^[A-Z][A-Z0-9_]{0,79}$/.test(name)) environment.push({name,reference:ref(n)})
      else unresolved.push({kind:'dynamic-environment-name',reference:ref(n)})
    }
  }
  for(const n of nodes) if(n.type==='VariableDeclarator'&&id(n.id)&&bindings.get(id(n.id))===1&&n.init?.type==='CallExpression') {
    const callee=n.init.callee
    if((expressNames.has(id(callee)) && bindings.get(id(callee))===1) || (routerNames.has(id(callee))&&bindings.get(id(callee))===1) || (member(callee)==='Router'&&expressNames.has(id(callee.object))&&bindings.get(id(callee.object))===1)) receivers.add(id(n.id))
  }
  for(const n of nodes) if(n.type==='CallExpression'&&n.callee.type==='MemberExpression') {
    const receiver=id(n.callee.object),method=member(n.callee)
    if(!['get','post','put','patch','delete','options','head','all','use'].includes(method)) continue
    const routePath=str(n.arguments[0])
    if(!receivers.has(receiver) || routePath===null || !routePath.startsWith('/')) {
      unresolved.push({kind:'unresolved-route-or-non-express-call',method,reference:ref(n)}); continue
    }
    const base={receiver,path:routePath,reference:ref(n),classification:'static-declaration-not-runtime-verification'}
    if(method==='use') {
      const targets=n.arguments.slice(1).map(a=>({local:id(a),module:requirePath(a)||modules.get(id(a))||null})).filter(a=>a.local||a.module)
      mounts.push({...base,targets,target:targets[0]?.local})
      if(!targets.length) unresolved.push({kind:'dynamic-mount-target',reference:ref(n)})
    } else routes.push({...base,method:method.toUpperCase()})
  }
  return {imports,exports,symbols,routes,mounts,environment,unresolved,parser:'@babel/parser',
    limitations:['Static syntax only; conditional registration, shadowing and middleware semantics require review. No code is executed.']}
}
function resolveMountedRoutes(files) {
  const result=[],unresolved=[]
  const paths=new Map(files.map(f=>[f.path,f]))
  function resolve(from,specifier) {
    if(!specifier?.startsWith('.')) return null
    const p=posix.normalize(posix.join(posix.dirname(from),specifier))
    return [p,...['.js','.ts','.jsx','.tsx','.cjs','.mjs','.cts','.mts','/index.js','/index.ts'].map(ext=>p+ext)].map(p=>paths.get(p)).find(Boolean)
  }
  const incoming=new Set()
  const edges=[]
  for(const file of files) for(const mount of file.mounts) for(const target of mount.targets) {
    let next=target.module ? resolve(file.path,target.module) : file
    const receiver=target.module ? next?.exports.find(e=>['exports','default'].includes(e.name)&&e.local)?.local : target.local
    if(!next || !receiver) { unresolved.push({kind:'unresolved-mounted-module',reference:mount.reference}); continue }
    const edge={from:file.path,receiver:mount.receiver,to:next.path,target:receiver,prefix:mount.path,reference:mount.reference}
    edges.push(edge); incoming.add(`${next.path}:${receiver}`)
  }
  let visits=0
  function walk(file,receiver,prefix,seen,chain=[]) {
    const key=`${file.path}:${receiver}`
    if(seen.has(key)||++visits>1000) { unresolved.push({kind:'mount-cycle-or-limit'}); return }
    const nextSeen=new Set(seen).add(key)
    const join=(a,b)=>(a.replace(/\/$/,'')+'/'+b.replace(/^\//,'')).replace(/\/$/,'')||'/'
    for(const route of file.routes.filter(r=>r.receiver===receiver)) {
      if(result.length>=1000) return
      result.push({...route,path:join(prefix,route.path),module:file.path,inferredMountChain:true,mountReferences:chain})
    }
    for(const e of edges.filter(e=>e.from===file.path&&e.receiver===receiver)) walk(paths.get(e.to),e.target,join(prefix,e.prefix),nextSeen,[...chain,e.reference])
  }
  for(const file of files) for(const receiver of new Set([...file.routes,...file.mounts].map(r=>r.receiver))) if(!incoming.has(`${file.path}:${receiver}`)) walk(file,receiver,'',new Set())
  if(!result.length && edges.length) unresolved.push({kind:'no-resolvable-root'})
  return {routes:result,unresolved,complete:false}
}
module.exports={analyzeSource,resolveMountedRoutes}
