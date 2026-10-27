import koffi from 'koffi'
const kernel = koffi.load('kernel32.dll')
const create = kernel.func('intptr __stdcall CreateJobObjectW(void *attributes, str16 name)')
const open = kernel.func('intptr __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)')
const set = kernel.func(
  'bool __stdcall SetInformationJobObject(intptr job, int kind, void *data, uint32 size)'
)
const assign = kernel.func('bool __stdcall AssignProcessToJobObject(intptr job, intptr process)')
const close = kernel.func('bool __stdcall CloseHandle(intptr handle)')
export function containCommand(pid: number): () => void {
  const job = Number(create(null, null))
  const processHandle = Number(open(0x1101, false, pid))
  try {
    const limits = Buffer.alloc(144)
    limits.writeUInt32LE(0x2000, 16)
    if (
      !job ||
      !processHandle ||
      !set(job, 9, limits, limits.length) ||
      !assign(job, processHandle)
    )
      throw new Error('Could not track the command process tree.')
    return () => {
      close(job)
    }
  } catch (error) {
    if (job) close(job)
    throw error
  } finally {
    if (processHandle) close(processHandle)
  }
}
export function constrainParser(pid: number): () => void {
  const job = Number(create(null, null))
  const process = Number(open(0x1101, false, pid))
  try {
    const limits = Buffer.alloc(144)
    limits.writeBigInt64LE(150000000n, 0)
    limits.writeUInt32LE(0x2102, 16)
    limits.writeBigUInt64LE(384n * 1024n * 1024n, 112)
    if (!job || !process || !set(job, 9, limits, limits.length) || !assign(job, process))
      throw new Error('Could not enforce parser process resource limits.')
    return () => {
      close(job)
    }
  } catch (error) {
    if (job) close(job)
    throw error
  } finally {
    if (process) close(process)
  }
}
