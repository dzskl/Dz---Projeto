import { redirect } from 'next/navigation';

/** A raiz nao tem conteudo proprio: encaminha para o painel. */
export default function Home(): never {
  redirect('/painel');
}
