# LegisMemoria

**LegisMemoria** é uma aplicação web de código aberto desenvolvida para auxiliar na memorização de textos legislativos e técnicos através de técnicas de recordação ativa (*Active Recall*) e repetição espaçada. O sistema implementa um algoritmo de decaimento temporal para simular a curva de esquecimento, permitindo ao usuário gerenciar revisões com precisão.

## Visão Geral do Projeto

O objetivo do sistema é fornecer uma plataforma onde estudantes e profissionais possam cadastrar trechos de leis, artigos ou conceitos e submetê-los a ciclos de estudo progressivos. O diferencial da aplicação reside no monitoramento em tempo real da "saúde" da memória de cada item cadastrado, incentivando a revisão nos momentos críticos antes que o conteúdo seja esquecido.

## Funcionalidades Principais

### Gestão de Conteúdo
* **Estrutura de Pastas e Cartões:** Organização hierárquica do conteúdo.
* **Operações CRUD:** Criação, leitura, atualização e exclusão de pastas e cartões de estudo.

### Metodologias de Estudo
1.  **Fase de Erosão (Oclusão Seletiva):** O sistema oculta aleatoriamente uma palavra do texto por vez. O usuário deve preencher a lacuna corretamente para avançar. Este método força a reconstrução contextual da informação.
2.  **Fase de Consolidação (Validação Integral):** Disponível após o usuário atingir 50% de proficiência. O usuário deve digitar o texto completo sequencialmente, sem visualização prévia das palavras futuras. Exige-se a conclusão de três ciclos perfeitos para a validação final (Nível 10).

### Algoritmo de Decaimento Temporal
O sistema utiliza uma lógica matemática determinística para calcular a retenção do conteúdo:
* **Estado Inicial:** Nível 0 (0% de retenção).
* **Estado Final:** Nível 10 (100% de retenção) após a conclusão do ciclo de consolidação.
* **Fator de Decaimento:** Redução de 1 nível (10%) a cada 3 horas sem revisão.
* **Monitoramento:** O painel de controle exibe o tempo exato restante para o próximo decaimento de nível.
* **Penalidade:** O uso do recurso de "Dica" resulta no reset imediato do nível do cartão para 0.

### Painel de Controle (Dashboard)
Interface analítica que fornece métricas em tempo real:
* **KPIs de Retenção:** Classificação dos cartões em zonas Crítica (<50%), Atenção (50-89%) e Segura (90-100%).
* **Análise Gráfica:** Gráficos de distribuição de status e média de proficiência por pasta.
* **Lista de Prioridade:** Identificação automática dos itens com maior urgência de revisão baseada no tempo restante para decaimento.

## Tecnologias Utilizadas

O projeto foi desenvolvido utilizando tecnologias web padrão, dispensando frameworks pesados ou dependências de servidor (backend-less).

* **HTML5:** Estruturação semântica.
* **CSS3:** Estilização responsiva e interface do usuário.
* **JavaScript (ES6+):** Lógica de aplicação, manipulação do DOM e cálculos de tempo.
* **Bootstrap 5:** Sistema de grid e componentes de interface.
* **Chart.js:** Renderização de gráficos de dados.
* **LocalStorage API:** Persistência de dados no navegador do cliente.

## Instalação e Execução

### Execução Local
Não é necessário ambiente de servidor (Node.js, PHP, etc.).
1.  Clone o repositório:
    ```bash
    git clone [https://github.com/SEU_USUARIO/legismemoria.git](https://github.com/SEU_USUARIO/legismemoria.git)
    ```
2.  Navegue até o diretório do projeto.
3.  Abra o arquivo `index.html` em qualquer navegador web moderno.

### Hospedagem (Deployment)
O projeto é compatível com qualquer serviço de hospedagem estática, como:
* GitHub Pages
* Netlify
* Vercel

## Considerações sobre Persistência de Dados

Este sistema utiliza o **LocalStorage** do navegador para armazenamento de dados.
* **Localidade:** Os dados residem exclusivamente no dispositivo e navegador onde foram criados. Não há sincronização em nuvem nativa.
* **Volatilidade:** A limpeza do cache ou dos dados de navegação resultará na perda dos registros de estudo.
* **Recomendação:** Utilize sempre o mesmo dispositivo e navegador para manter a continuidade dos estudos.

## Licença

Distribuído sob a licença MIT. Veja o arquivo `LICENSE` para mais informações.
