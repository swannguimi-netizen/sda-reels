import { Construction } from 'lucide-react'
import { PageHeader } from '../../components/ui'

export default function ComingSoonPage({ title, step }: { title: string; step: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="card flex flex-col items-center px-6 py-16 text-center">
        <Construction className="h-10 w-10 text-brand-500" />
        <p className="mt-4 font-semibold text-slate-900">Module en cours de construction</p>
        <p className="mt-1 text-sm text-slate-500">Prévu à l’étape : {step}</p>
      </div>
    </>
  )
}
