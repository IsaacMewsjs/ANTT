# ANTT MVP

Para rodar no browser (sem bloqueio de módulos ES), use um servidor local:

1. `npm install`
2. `npm run dev`
3. Abra http://localhost:5173

Se preferir, você pode usar outro servidor local equivalente.

## KM via IBGE (rota mais curta)

O calculo de KM agora usa os codigos IBGE de origem/destino e uma rota de menor distancia.

Requisitos:
1. A planilha precisa ter as colunas `IBGE CID ORG` e `IBGE CID DEST`.
2. Defina sua chave do OpenRouteService em `src/config.js` (variavel `ORS_API_KEY`).
3. O app baixa um mapa IBGE->lat/long do dataset publico (MIT):
	https://github.com/kelvins/municipios-brasileiros

O app:
- lê a aba `BASE DE DADOS`;
- tenta localizar a aba `TABELA ANTT`;
- calcula o frete ANTT por linha;
- deriva o valor da empresa com fallback para `FRETE - R$/TON`, `FRETE TON/KM` e `KM`;
- classifica cada linha em `frete 1`, `frete 2` ou `conforme` usando diferença em reais;
- exporta um novo arquivo `.xlsx` com os resultados.

Estrutura principal:
- `index.html`: shell da interface;
- `src/app.js`: fluxo da tela;
- `src/antt.js`: motor ANTT;
- `src/excel.js`: leitura da planilha;
- `src/utils.js`: helpers de texto e número.

Se o seu arquivo usar nomes de colunas diferentes, ajuste os seletores no módulo `src/app.js`.
