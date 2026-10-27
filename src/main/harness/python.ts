import { spawn } from 'child_process'
import { constrainParser } from '../security/worker-job'

export const PYTHON_WORKER = String.raw`
import ast, csv, io, json, math, operator, sys
from decimal import Decimal
from fractions import Fraction
payload = json.loads(sys.stdin.buffer.read(600001))
expression = payload['expression']
if len(expression) > 2000: raise ValueError('Expression too long')
data = payload.get('csv', '')
reader = csv.DictReader(io.StringIO(data.lstrip('\ufeff')), strict=True) if data else None
rows = list(reader) if reader else []
columns = reader.fieldnames if reader else []
if data and (not columns or any(not x for x in columns) or len(set(columns)) != len(columns)): raise ValueError('CSV needs distinct nonempty column names')
if any(None in row or None in row.values() for row in rows): raise ValueError('CSV row width differs from header')
if len(rows) > 10000: raise ValueError('At most 10000 CSV rows')
functions = {k: getattr(math, k) for k in ('sqrt','sin','cos','tan','log','log10','exp','floor','ceil','isfinite')}
functions.update({'sum': sum, 'min': min, 'max': max, 'len': len, 'abs': abs, 'round': round, 'int': int, 'float': float, 'str': str, 'sorted': sorted, 'Decimal': Decimal, 'Fraction': Fraction})
binary = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv, ast.FloorDiv: operator.floordiv, ast.Mod: operator.mod, ast.Pow: operator.pow}
compare = {ast.Eq: operator.eq, ast.NotEq: operator.ne, ast.Lt: operator.lt, ast.LtE: operator.le, ast.Gt: operator.gt, ast.GtE: operator.ge, ast.In: lambda a,b: a in b, ast.NotIn: lambda a,b: a not in b}
steps = 0
def bounded(value):
    if isinstance(value, int) and value.bit_length() > 4096: raise ValueError('Integer too large')
    if isinstance(value, (str, list, tuple, dict)) and len(value) > 10000: raise ValueError('Result too large')
    return value
def run(node, env):
    global steps
    steps += 1
    if steps > 250000: raise ValueError('Expression operation limit')
    if isinstance(node, ast.Constant) and isinstance(node.value, (str, int, float, bool, type(None))): return bounded(node.value)
    if isinstance(node, ast.Name) and node.id in env: return env[node.id]
    if isinstance(node, (ast.List, ast.Tuple)): return bounded([run(x,env) for x in node.elts])
    if isinstance(node, ast.Dict): return bounded({run(k,env):run(v,env) for k,v in zip(node.keys,node.values)})
    if isinstance(node, ast.Subscript): return bounded(run(node.value,env)[run(node.slice,env)])
    if isinstance(node, ast.Slice): return slice(run(node.lower,env) if node.lower else None, run(node.upper,env) if node.upper else None, run(node.step,env) if node.step else None)
    if isinstance(node, ast.BinOp) and type(node.op) in binary:
        a,b = run(node.left,env),run(node.right,env)
        if isinstance(node.op, ast.Pow) and (not isinstance(b,(int,float)) or abs(b)>1000): raise ValueError('Exponent limit')
        if isinstance(node.op, ast.Mult) and (isinstance(a,(str,list,tuple)) or isinstance(b,(str,list,tuple))): raise ValueError('Sequence multiplication unavailable')
        return bounded(binary[type(node.op)](a,b))
    if isinstance(node, ast.UnaryOp):
        a = run(node.operand,env)
        if isinstance(node.op, ast.USub): return -a
        if isinstance(node.op, ast.UAdd): return +a
        if isinstance(node.op, ast.Not): return not a
    if isinstance(node, ast.BoolOp):
        for item in node.values:
            value = run(item,env)
            if isinstance(node.op,ast.And) and not value: return value
            if isinstance(node.op,ast.Or) and value: return value
        return value
    if isinstance(node, ast.Compare):
        a = run(node.left,env)
        for op,right in zip(node.ops,node.comparators):
            b = run(right,env)
            if type(op) not in compare or not compare[type(op)](a,b): return False
            a = b
        return True
    if isinstance(node, ast.IfExp): return run(node.body if run(node.test,env) else node.orelse,env)
    if isinstance(node, (ast.ListComp,ast.GeneratorExp)) and len(node.generators)==1:
        gen = node.generators[0]
        if not isinstance(gen.target,ast.Name) or gen.is_async: raise ValueError('Invalid comprehension')
        values = run(gen.iter,env)
        if not isinstance(values,(list,tuple)) or len(values)>10000: raise ValueError('Invalid iterable')
        result=[]
        for value in values:
            child=dict(env); child[gen.target.id]=value
            if all(run(test,child) for test in gen.ifs): result.append(run(node.elt,child))
        return bounded(result)
    if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and node.func.id in functions and not node.keywords:
        return bounded(functions[node.func.id](*[run(arg,env) for arg in node.args]))
    raise ValueError('Unsupported Python expression: '+type(node).__name__)
result = run(ast.parse(expression, mode='eval').body, {'rows': rows, 'pi': math.pi, 'e': math.e})
output=json.dumps({'result':result,'rows':len(rows),'columns':columns},allow_nan=False,default=lambda value: str(value) if isinstance(value,(Decimal,Fraction)) else None)
if len(output)>16000: raise ValueError('Output exceeds 16000 characters; aggregate or filter the data')
print(output)
`

export function pythonExpression(
  expression: string,
  csv = '',
  signal?: AbortSignal
): Promise<string> {
  if (expression.length > 2000 || Buffer.byteLength(csv) > 512000)
    return Promise.reject(new Error('Python input exceeds its limit.'))
  if (signal?.aborted) return Promise.reject(new Error('Python cancelled.'))
  return new Promise((resolve, reject) => {
    const child = spawn('python', ['-I', '-S', '-c', PYTHON_WORKER], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let output = '',
      error = '',
      release: (() => void) | undefined,
      failure: Error | undefined
    const stop = (): void => {
      failure ??= new Error('Python cancelled.')
      child.kill()
    }
    const timer = setTimeout(() => {
      failure = new Error('Python exceeded ten seconds.')
      child.kill()
    }, 10000)
    signal?.addEventListener('abort', stop, { once: true })
    child.once('spawn', () => {
      try {
        if (process.platform === 'win32') release = constrainParser(child.pid!)
      } catch (cause) {
        failure = cause as Error
        child.kill()
        return
      }
      child.stdin.end(JSON.stringify({ expression, csv }))
    })
    child.stdout.on('data', (chunk) => {
      output += chunk.toString()
      if (output.length > 17000) {
        failure = new Error('Python output limit.')
        child.kill()
      }
    })
    child.stderr.on('data', (chunk) => {
      error = (error + chunk.toString()).slice(-2000)
    })
    child.stdin.on('error', () => {})
    child.once('error', (cause) => {
      failure = cause
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
      release?.()
      if (failure || code !== 0)
        reject(
          failure ??
            new Error(error || 'Python failed. Install Python 3 and make it available on PATH.')
        )
      else resolve(output.trim())
    })
  })
}
