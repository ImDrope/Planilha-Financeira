# Despesa Mensal — Dashboard Financeiro Pessoal

Aplicação web pessoal para registrar receitas, despesas, compras parceladas e investimentos, acompanhar o orçamento mensal e visualizar previsões, análises e conquistas.

## Funcionalidades

- Recorrências mensais, semanais ou anuais, com período de vigência, geração automática e meses ignorados.
- Compras parceladas integradas à área de Despesas, sem cadastro de cartão, distribuídas automaticamente nos meses futuros.
- Indicadores separados de saldo atual e previsto, pagamentos, pendências, vencimentos e receitas esperadas.
- Filtro rápido “Todos” no Dashboard e movimentações apresentadas como cards no celular.
- Área de Investimentos com meta mensal, aportes, resgates, rendimentos, valor atual estimado, alertas de atualização, rentabilidade, objetivos e evolução histórica.
- Orçamento geral e limites específicos por categoria.
- Fechamento mensal permanente, comparação com o mês anterior, transferência de pendências e relatório em PDF.
- Assistente inicial para configurar renda, limite, meta de investimento e primeiras recorrências.
- Gráficos, metas, pontuação, conquistas, tema claro/escuro e controles de privacidade.
- Exportação e importação de backup em JSON.
- Interface responsiva para computador e celular.

## Como testar

Abra o arquivo `index.html` no navegador. Não é necessário instalar dependências, Node.js ou banco de dados.

## Armazenamento e privacidade

Os dados são salvos no `localStorage` e permanecem apenas no navegador e dispositivo em que o site foi usado. Use a área **Dados e privacidade** para exportar um backup antes de limpar os dados do navegador ou trocar de dispositivo.

## Arquivos

- `index.html`: estrutura e formulários da interface.
- `styles.css`: estilos responsivos para desktop e mobile.
- `app.js`: regras financeiras, gráficos, armazenamento e interações.

## GitHub Pages

O projeto pode ser publicado diretamente no GitHub Pages. Como os dados ficam no navegador, publicar o código não envia os registros financeiros ao GitHub.
