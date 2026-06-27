# Eliminatorias

O sistema suporta jogos a eliminar com `group_id='KO'`, bracket com placeholders,
propagacao automatica do vencedor para o jogo seguinte e escolha do vencedor da
eliminatoria quando o resultado aos 120 minutos for empate.

## Pontuacao

Nas eliminatorias, o marcador previsto e sempre o resultado ao fim dos 120 minutos.
Se esse resultado for empate, o utilizador tem de escolher o vencedor da eliminatoria.

| Situacao | Pontos |
|---|---|
| Marcador exacto aos 120 | 3 pontos |
| Apenas tendencia aos 120 (vitoria/empate/derrota) | 1 ponto |
| Acertar quem passa | +1 ponto |

Maximo por jogo a eliminar: 4 pontos.

## Admin

A aba Resultados tem toggle entre grupos e eliminatorias. Nas eliminatorias, o admin
pode editar placeholders de equipas/flags/data/hora/estadio, guardar o resultado aos
120 minutos e escolher quem passou quando houver empate.

Ao guardar o vencedor de uma eliminatoria, o sistema preenche automaticamente o jogo
seguinte do bracket quando `next_match_id` e `next_slot` estiverem definidos.

## Bloqueio de previsoes

Jogos com placeholders, como `W74` ou `3.º Grupo C/E/F/H/I`, ficam bloqueados para
previsao ate terem as duas equipas definidas.
