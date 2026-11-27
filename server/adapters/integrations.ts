// Status real de cada integracao. Nenhuma integracao e simulada: sem credencial, a etapa fica "nao_configurada".
export type Integration = { key: string; name: string; purpose: string; status: "ativa" | "nao_configurada" | "semiautomatica"; needs: string; cost: string; limitations: string };

export const anthropicConfigured = () => !!process.env.ANTHROPIC_API_KEY;
export const meliConfigured = () => !!(process.env.MELI_CLIENT_ID && process.env.MELI_CLIENT_SECRET && process.env.MELI_REFRESH_TOKEN);
export const ebayConfigured = () => !!(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET);

export function integrations(): Integration[] {
  return [
    { key: "bcb_ptax", name: "Banco Central — PTAX", purpose: "Câmbio oficial para anúncios internacionais", status: "ativa", needs: "Nenhuma credencial", cost: "Gratuito", limitations: "Cotação de dias úteis; moedas fora da PTAX ficam sem conversão." },
    { key: "lenovo", name: "Lenovo Parts Lookup", purpose: "FRU oficial, compatibilidades, substitutos e fotos", status: "semiautomatica", needs: "Sem API pública. Blocos de até 100 SKUs colados no site e resultado importado.", cost: "Gratuito", limitations: "Depende de ação manual; acesso automatizado somente com autorização da Lenovo." },
    { key: "gemini", name: "Gemini 2.5 Flash — Google Search", purpose: "Pesquisa técnica e comercial", status: process.env.GEMINI_API_KEY ? "ativa" : "nao_configurada", needs: "GEMINI_API_KEY no .env", cost: "Modalidade gratuita sujeita às cotas do projeto; mantenha faturamento desativado", limitations: "Credencial configurada não significa conexão testada. URLs sem confirmação são descartadas; Lenovo continua semiautomática." },
    { key: "meli", name: "Mercado Livre API", purpose: "Anúncios nacionais com link direto, vendedor, estoque e vendidos", status: meliConfigured() ? "ativa" : "nao_configurada", needs: "App no developers.mercadolivre.com.br (MELI_CLIENT_ID, MELI_CLIENT_SECRET, MELI_REFRESH_TOKEN)", cost: "Gratuito", limitations: "Limites de requisição da API." },
    { key: "ebay", name: "eBay Browse API", purpose: "Anúncios internacionais", status: ebayConfigured() ? "ativa" : "nao_configurada", needs: "Conta em developer.ebay.com (EBAY_CLIENT_ID, EBAY_CLIENT_SECRET)", cost: "Gratuito", limitations: "5.000 chamadas/dia no plano padrão." },
  ];
}
