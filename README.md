# Finance Quest — Dashboard Financeiro Pessoal

Aplicação web pessoal para registrar receitas, despesas e investimentos, acompanhar o orçamento mensal e visualizar análises e conquistas.

## O que mudou nesta versão

- Novo dashboard inspirado nas referências fornecidas, adaptado para desktop e mobile.
- Cabeçalho com navegação rápida entre meses.
- Cartão principal de patrimônio acompanhado.
- Resumo em quatro cartões: Receita, Investir, Despesas e Saldo.
- Alternância entre visualização em tabela e gráficos.
- Filtros rápidos de Receita, Fixa e Variável no dashboard.
- Página de Orçamento redesenhada.
- Página de Patrimônio redesenhada.
- Navegação inferior no celular.
- Botão de privacidade para ocultar e exibir valores.
- Todas as funcionalidades da primeira versão foram mantidas.

## Como testar

1. Extraia o arquivo ZIP.
2. Abra a pasta `finance-quest`.
3. Clique duas vezes em `index.html`.

Não é necessário instalar dependências, Node.js ou banco de dados.

## Armazenamento

Os dados são salvos no `localStorage` do navegador. Eles permanecem apenas no navegador e dispositivo em que o site foi usado.

Use a área **Dados e privacidade** para exportar um backup em JSON antes de limpar os dados do navegador ou trocar de dispositivo.

## Arquivos

- `index.html`: estrutura da interface.
- `styles.css`: estilos responsivos para desktop e mobile.
- `app.js`: cálculos, gráficos, formulários, armazenamento e interações.

## GitHub Pages

O projeto pode ser publicado diretamente no GitHub Pages. Como os dados ficam no navegador, publicar o código não envia os registros financeiros ao GitHub.
