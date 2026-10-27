const python = `from functools import lru_cache

@lru_cache(maxsize=None)
def fib(n: int) -> int:
    """Return the nth Fibonacci number."""
    return n if n < 2 else fib(n - 1) + fib(n - 2)

print([fib(i) for i in range(10)])
# [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]
`
const fence = (language, code) => '```' + language + '\n' + code + '```'
const math = String.raw`### Algebra and calculus
When $ax^2 + bx + c = 0$, the roots follow the quadratic formula:

$$
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$

Inline TeX also works: \(f'(x) = 3x^2\).

\[\int_a^b f(x)\,dx = F(b) - F(a)\]

### Aligned equations, matrices and cases
$$
\begin{aligned}
(a+b)^3 &= (a+b)(a+b)^2 \\
 &= a^3 + 3a^2b + 3ab^2 + b^3
\end{aligned}
$$

$$
\underbrace{\begin{bmatrix}\cos\theta & -\sin\theta \\ \sin\theta & \cos\theta\end{bmatrix}}_{\text{Rotation matrix}}
\begin{bmatrix}x\\y\end{bmatrix} = \begin{bmatrix}x'\\y'\end{bmatrix}
$$

$$
f(x) = \begin{cases}x^2, & x < 0 \\ \sqrt{x}, & 0 \le x \le 4 \\ 2x-6, & x > 4\end{cases}
$$

$$
\boxed{P(A\mid B) = \frac{P(B\mid A)P(A)}{P(B)}}
$$`
const code = [
  '### Code\nPython:',
  fence('python', python),
  'JavaScript:',
  fence(
    'javascript',
    'const debounce = (fn, delay = 300) => {\n  let timer;\n  return (...args) => {\n    clearTimeout(timer);\n    timer = setTimeout(() => fn(...args), delay);\n  };\n};\n'
  ),
  'SQL:',
  fence(
    'sql',
    "SELECT department, COUNT(*) AS headcount, AVG(salary) AS avg_salary\nFROM employees\nWHERE hire_date >= '2020-01-01'\nGROUP BY department\nHAVING COUNT(*) > 5\nORDER BY avg_salary DESC;\n"
  ),
  'Bash:',
  fence(
    'bash',
    '#!/usr/bin/env bash\nfor f in *.log; do\n  gzip "$f" && echo "Compressed $f"\ndone\n'
  ),
  'A diff:',
  fence(
    'diff',
    '- const total = items.reduce((a, b) => a + b);\n+ const total = items.reduce((a, b) => a + b, 0);\n'
  ),
  'Unknown languages stay readable:',
  fence('custom-language', '<script>window.bad = true</script>\n\\(keep this literal\\)\n'),
  'Inline code: `\\(also literal\\)` and `const n = 1`.',
  '| Format | Support |\n| --- | --- |\n| Math | Inline and display |\n| Code | Highlight and copy |'
].join('\n\n')
module.exports = { python, math, code, showcase: math + '\n\n' + code }
