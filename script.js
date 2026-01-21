// ==========================================
// 1. ESTADO GLOBAL
// ==========================================
let db = JSON.parse(localStorage.getItem('legisDB')) || { pastas: [] };
let pastaAtivaIdx = null;
let cardAtivoRef = null;
let idCardEmEdicao = null;

// Variáveis de Jogo
let wordsData = [];
let indicesOcultosAcumulados = [];
let indicesPalavrasUteis = [];
let listaErros = new Set();
let modoFinalAtivo = false; 
let cicloFinal = 0; 
let indicePalavraEsperadaNoModoFinal = 0;
let maxCiclosDestaSessao = 1;

// Stats e UI
let totalAcertos = 0;
let totalErros = 0;
let segundosCardAtual = 0;
let cronometroInterval = null;
let bootstrapModal = null;
let chartDist = null;
let chartBar = null;

const stopWords = ["a", "o", "as", "os", "de", "do", "da", "dos", "das", "e", "em", "um", "uma", "uns", "umas", "com", "por", "para", "que", "se", "no", "na", "nos", "nas", "ao", "aos", "pelo", "pela", "pelos", "pelas", "ou", "é", "são", "foi", "nao", "não"];

// ==========================================
// 2. TEMA (MODO NOTURNO)
// ==========================================
function alternarTema() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    
    const btn = document.getElementById('btnTema');
    if(btn) btn.innerText = isDark ? '☀️' : '🌙';
    
    atualizarDashboard(); // Atualiza gráficos
}

function carregarTema() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
        const btn = document.getElementById('btnTema');
        if(btn) btn.innerText = '☀️';
    }
}

// ==========================================
// 3. UTILITÁRIOS E SANITIZAÇÃO
// ==========================================
function sanitizarBancoDeDados() {
    let houveMudanca = false;
    db.pastas.forEach(p => {
        p.cards.forEach(c => {
            if (c.nivel > 10) { c.nivel = 10; houveMudanca = true; }
            if (c.nivel < 0) { c.nivel = 0; houveMudanca = true; }
        });
    });
    if (houveMudanca) salvarDB();
}

function normalizar(str) {
    if (!str) return "";
    return str.toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[.,\/#!$%\^&\*;:{}=\_~()]/g, "")
        .trim();
}

function salvarDB() {
    localStorage.setItem('legisDB', JSON.stringify(db));
}

function formatarTempo(s) {
    const min = Math.floor(s / 60).toString().padStart(2, '0');
    const seg = (s % 60).toString().padStart(2, '0');
    return `${min}:${seg}`;
}

// ==========================================
// 4. LÓGICA DE DECAIMENTO
// ==========================================
function getDadosDecaimento(card) {
    const duracaoPorNivel = {
        10: 13, 9: 12, 8: 10,
        7: 9, 6: 8, 5: 7,
        4: 6, 3: 5, 2: 4, 1: 3
    };

    const nivelSalvo = Math.min(10, Math.max(0, card.nivel || 0));
    
    if (!card.ultimoEstudo) {
        return { nivelInt: 0, estabilidade: "0.0", msParaQueda: 0 };
    }

    const agora = Date.now();
    const horasPassadas = (agora - card.ultimoEstudo) / (1000 * 60 * 60);

    let nivelAtual = nivelSalvo;
    let tempoRestanteParaDeduzir = horasPassadas;
    let msParaQueda = 0;
    let porcentagemEstabilidade = 0;

    while (nivelAtual > 0) {
        const duracaoDesteNivel = duracaoPorNivel[nivelAtual];
        if (tempoRestanteParaDeduzir < duracaoDesteNivel) {
            const horasParaCair = duracaoDesteNivel - tempoRestanteParaDeduzir;
            msParaQueda = horasParaCair * 60 * 60 * 1000;
            const ratio = horasParaCair / duracaoDesteNivel;
            porcentagemEstabilidade = ratio * 100;
            break; 
        } else {
            tempoRestanteParaDeduzir -= duracaoDesteNivel;
            nivelAtual--;
        }
    }

    if (nivelAtual <= 0) {
        nivelAtual = 0;
        porcentagemEstabilidade = 0;
        msParaQueda = 0;
    }

    return {
        nivelInt: nivelAtual,
        estabilidade: porcentagemEstabilidade.toFixed(1), 
        msParaQueda: msParaQueda
    };
}

// ==========================================
// 5. UI - NAVEGAÇÃO
// ==========================================
function esconderTodasTelas() {
    ['dashboardArea', 'setupArea', 'trainingArea'].forEach(id => {
        document.getElementById(id).classList.add('d-none');
    });
}

function voltarAoDashboard() {
    clearInterval(cronometroInterval);
    esconderTodasTelas();
    document.getElementById('dashboardArea').classList.remove('d-none');
    atualizarDashboard();
}

function mostrarSetup(isEdit = false) {
    if (pastaAtivaIdx === null) return alert("Selecione uma pasta!");
    esconderTodasTelas();
    document.getElementById('setupArea').classList.remove('d-none');
    if (!isEdit) {
        idCardEmEdicao = null;
        document.getElementById('setupTitle').innerText = "Novo Card";
        document.getElementById('cardTitle').value = "";
        document.getElementById('rawText').value = "";
    }
}

// ==========================================
// 6. CRUD PASTAS & CARDS
// ==========================================
function criarPasta() {
    const nome = document.getElementById('novaPastaNome').value.trim();
    if (!nome) return;
    db.pastas.push({ nome: nome, cards: [] });
    salvarDB();
    document.getElementById('novaPastaNome').value = "";
    renderizarPastas();
    selecionarPasta(db.pastas.length - 1);
}

function renderizarPastas() {
    const lista = document.getElementById('listaPastas');
    lista.innerHTML = db.pastas.map((p, idx) => {
        const isActive = pastaAtivaIdx === idx ? 'active' : '';
        return `
        <div class="folder-container ${isActive}">
            <button onclick="selecionarPasta(${idx})" class="folder-btn-main">
                📁 ${p.nome}
            </button>
            <div class="folder-actions">
                <button onclick="editarPasta(${idx})" class="action-btn" title="Renomear">✎</button>
                <button onclick="excluirPasta(${idx})" class="action-btn text-danger" title="Excluir">×</button>
            </div>
        </div>`;
    }).join('');
}

function editarPasta(idx) {
    const novoNome = prompt("Novo nome:", db.pastas[idx].nome);
    if (novoNome && novoNome.trim()) {
        db.pastas[idx].nome = novoNome.trim();
        salvarDB();
        renderizarPastas();
        if (pastaAtivaIdx === idx) document.getElementById('tituloPastaAtiva').innerText = novoNome;
    }
}

function excluirPasta(idx) {
    if (confirm("Excluir pasta e cards?")) {
        db.pastas.splice(idx, 1);
        pastaAtivaIdx = null;
        salvarDB();
        renderizarPastas();
        document.getElementById('tituloPastaAtiva').innerText = "Nenhuma Pasta";
        document.getElementById('listaCards').innerHTML = "";
        document.getElementById('btnNovoCard').classList.add('d-none');
        atualizarDashboard();
    }
}

function selecionarPasta(idx) {
    pastaAtivaIdx = idx;
    document.getElementById('tituloPastaAtiva').innerText = db.pastas[idx].nome;
    document.getElementById('btnNovoCard').classList.remove('d-none');
    renderizarPastas();
    renderizarCards();
    atualizarDashboard();
}

function renderizarCards() {
    const lista = document.getElementById('listaCards');
    if (pastaAtivaIdx === null) { lista.innerHTML = ""; return; }
    
    const cards = db.pastas[pastaAtivaIdx].cards;
    document.getElementById('contagemCards').innerText = `${cards.length} cards`;
    
    lista.innerHTML = cards.map(c => {
        const dados = getDadosDecaimento(c);
        let corBadge = 'bg-danger';
        if (dados.nivelInt >= 8) corBadge = 'bg-success';
        else if (dados.nivelInt >= 4) corBadge = 'bg-warning text-dark';
        
        return `
        <div class="card-item-container">
            <button onclick="carregarCard(${c.id})" class="card-main-btn">
                <span class="badge ${corBadge} me-1" style="font-size:0.6rem; width:20px;">${dados.nivelInt}</span>
                ${c.titulo}
            </button>
            <div class="card-actions">
                <button onclick="editarCard(${c.id})" class="action-btn" title="Editar">✎</button>
                <button onclick="excluirCard(${c.id})" class="action-btn text-danger" title="Excluir">×</button>
            </div>
        </div>`;
    }).join('');
}

function salvarCard() {
    const titulo = document.getElementById('cardTitle').value.trim();
    const texto = document.getElementById('rawText').value.trim();
    if (!titulo || !texto) return alert("Preencha tudo.");

    const cards = db.pastas[pastaAtivaIdx].cards;

    if (idCardEmEdicao) {
        const card = cards.find(c => c.id === idCardEmEdicao);
        if (card) {
            card.titulo = titulo;
            card.texto = texto;
            card.nivel = 0; 
            card.ultimoEstudo = null;
        }
    } else {
        cards.push({
            id: Date.now(),
            titulo: titulo,
            texto: texto,
            nivel: 0, 
            ultimoEstudo: null,
            winrate: 100,
            tempoEstudo: 0
        });
    }
    salvarDB();
    renderizarCards();
    voltarAoDashboard();
}

function editarCard(id) {
    const card = db.pastas[pastaAtivaIdx].cards.find(c => c.id === id);
    if (!card) return;
    mostrarSetup(true);
    idCardEmEdicao = id;
    document.getElementById('setupTitle').innerText = "Editar Card";
    document.getElementById('cardTitle').value = card.titulo;
    document.getElementById('rawText').value = card.texto;
}

function excluirCard(id) {
    if (confirm("Excluir card?")) {
        db.pastas[pastaAtivaIdx].cards = db.pastas[pastaAtivaIdx].cards.filter(c => c.id !== id);
        salvarDB();
        renderizarCards();
        atualizarDashboard();
    }
}

// ==========================================
// 7. DASHBOARD & RENDERIZAÇÃO DA LISTA
// ==========================================
function atualizarDashboard() {
    let nCritico = 0, nAtencao = 0, nSeguro = 0;
    let tempoTotalSeg = 0;
    const dadosPastas = [];

    db.pastas.forEach(p => {
        let somaNivel = 0;
        p.cards.forEach(c => {
            const dados = getDadosDecaimento(c);
            tempoTotalSeg += (c.tempoEstudo || 0);
            if (dados.nivelInt < 4) nCritico++;
            else if (dados.nivelInt < 8) nAtencao++;
            else nSeguro++;
            somaNivel += dados.nivelInt;
        });
        const media = p.cards.length ? (somaNivel / p.cards.length) : 0;
        dadosPastas.push({ nome: p.nome, media: media.toFixed(1) });
    });

    document.getElementById('kpiCriticos').innerText = nCritico;
    document.getElementById('kpiAtencao').innerText = nAtencao;
    document.getElementById('kpiSeguros').innerText = nSeguro;
    document.getElementById('dashTempoTotal').innerText = formatarTempo(tempoTotalSeg);
    
    renderizarListaDecaimento();
    renderizarGraficoPizza(nCritico, nAtencao, nSeguro);
    renderizarGraficoBarras(dadosPastas);
}

function renderizarListaDecaimento() {
    const lista = [];
    db.pastas.forEach(p => {
        p.cards.forEach(c => {
            const dados = getDadosDecaimento(c);
            lista.push({ 
                id: c.id, 
                titulo: c.titulo, 
                pasta: p.nome, 
                nivelInt: dados.nivelInt,
                estabilidade: dados.estabilidade, 
                msParaQueda: dados.msParaQueda,
                isZero: dados.nivelInt === 0
            });
        });
    });

    // Ordenação: Nível (Crescente) -> Tempo (Crescente)
    lista.sort((a,b) => {
        if (a.nivelInt !== b.nivelInt) {
            return a.nivelInt - b.nivelInt; 
        }
        return a.msParaQueda - b.msParaQueda;
    });
    
    const container = document.getElementById('dashDecaimento');
    
    if (lista.length === 0) {
        container.innerHTML = '<div class="text-center text-muted p-4">Nenhum card criado.</div>';
    } else {
        container.innerHTML = lista.map(item => {
            const h = Math.floor(item.msParaQueda / 3600000);
            const m = Math.floor((item.msParaQueda % 3600000) / 60000);
            
            let corBarra = 'var(--bs-warning)';
            let corClasse = 'text-warning-emphasis';
            let bgClasse = 'bg-warning-subtle';

            if (item.nivelInt < 4) { 
                corBarra = 'var(--bs-danger)'; 
                corClasse = 'text-danger';
                bgClasse = 'bg-danger-subtle';
            } else if (item.nivelInt >= 8) { 
                corBarra = 'var(--bs-success)';
                corClasse = 'text-success';
                bgClasse = 'bg-success-subtle';
            }

            const tempoTxt = item.isZero ? 'AGORA' : `${h}h ${m}m`;
            const tempoCor = item.isZero ? 'text-danger fw-bold' : 'text-muted';

            return `
            <div class="decay-item-row" onclick="carregarCard(${item.id})" title="Clique para estudar">
                <div class="decay-level-indicator" style="background-color: ${corBarra};">
                    <span style="color:white; font-weight:bold; font-size:0.8rem;">${item.nivelInt}</span>
                </div>
                <div class="decay-content">
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <strong class="decay-title text-truncate" style="font-size:0.95rem;">${item.titulo}</strong>
                        <span class="badge ${bgClasse} ${corClasse} border border-opacity-10 rounded-pill">${item.estabilidade}%</span>
                    </div>
                    <div class="d-flex justify-content-between align-items-center">
                        <small class="text-secondary small fst-italic">📂 ${item.pasta}</small>
                        <small class="${tempoCor} small"><span style="opacity:0.7">Queda:</span> ${tempoTxt}</small>
                    </div>
                </div>
            </div>`;
        }).join('');
    }
}

// ==========================================
// 8. CHARTS
// ==========================================
function renderizarGraficoPizza(crit, atenc, seg) {
    const ctx = document.getElementById('chartDistribuicao');
    if (chartDist) chartDist.destroy();
    
    const isDark = document.body.classList.contains('dark-mode');
    const colorText = isDark ? '#e0e0e0' : '#666';
    const borderColor = isDark ? '#1e1e1e' : '#fff';

    chartDist = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Crítico', 'Atenção', 'Seguro'],
            datasets: [{
                data: [crit, atenc, seg],
                backgroundColor: ['#dc3545', '#ffc107', '#198754'],
                borderWidth: 2,
                borderColor: borderColor
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { legend: { labels: { color: colorText } } }
        }
    });
}

function renderizarGraficoBarras(dados) {
    const ctx = document.getElementById('chartBarras');
    if (chartBar) chartBar.destroy();
    
    const isDark = document.body.classList.contains('dark-mode');
    const colorText = isDark ? '#e0e0e0' : '#666';
    const gridColor = isDark ? '#444' : '#e9ecef';

    chartBar = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: dados.map(d => d.nome),
            datasets: [{
                label: 'Média Nível',
                data: dados.map(d => d.media),
                backgroundColor: '#0d6efd'
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            scales: { 
                y: { max: 10, ticks: { color: colorText }, grid: { color: gridColor } },
                x: { ticks: { color: colorText }, grid: { display: false } }
            },
            plugins: { legend: { labels: { color: colorText } } }
        }
    });
}

// ==========================================
// 9. MOTOR DE TREINO
// ==========================================
function carregarCard(id) {
    let cardEncontrado = null;
    let pastaIndex = -1;

    // Busca o card e a pasta dele para ativar o contexto
    db.pastas.forEach((p, idx) => {
        const c = p.cards.find(x => x.id === id);
        if(c) {
            cardEncontrado = c;
            pastaIndex = idx;
        }
    });

    if(!cardEncontrado) return alert("Erro: Card não encontrado.");

    pastaAtivaIdx = pastaIndex;
    cardAtivoRef = cardEncontrado;

    const dados = getDadosDecaimento(cardAtivoRef);
    cardAtivoRef.nivel = dados.nivelInt; 
    
    esconderTodasTelas();
    document.getElementById('trainingArea').classList.remove('d-none');
    
    document.getElementById('tituloCardAtivo').innerText = cardAtivoRef.titulo;
    document.getElementById('nivelFixacao').innerText = `${cardAtivoRef.nivel}/10`;
    document.getElementById('errorArea').classList.add('d-none');
    
    totalAcertos = 0; totalErros = 0; listaErros.clear();
    atualizarWinrate();
    iniciarCronometro();
    
    prepararTreino(cardAtivoRef.texto, false);
}

function iniciarCronometro() {
    clearInterval(cronometroInterval);
    segundosCardAtual = 0;
    document.getElementById('cronometroDisplay').innerText = "00:00";
    cronometroInterval = setInterval(() => {
        segundosCardAtual++;
        document.getElementById('cronometroDisplay').innerText = formatarTempo(segundosCardAtual);
    }, 1000);
}

function prepararTreino(text, forcarResetPorDica = false) {
    indicesOcultosAcumulados = [];
    indicesPalavrasUteis = [];
    modoFinalAtivo = false;
    cicloFinal = 0;
    indicePalavraEsperadaNoModoFinal = 0;

    wordsData = text.split(/\s+/).filter(w => w.trim() !== "").map((word, index) => {
        const clean = normalizar(word);
        const isConnector = stopWords.includes(clean);
        if (!isConnector && clean.length > 0) indicesPalavrasUteis.push(index);
        return { original: word, clean: clean, isConnector: isConnector, reveladaNoCiclo: false };
    });
    
    const isVirgem = !cardAtivoRef.ultimoEstudo;
    const nivelAtual = cardAtivoRef.nivel;
    let deveFazerErosao = false;
    maxCiclosDestaSessao = 1;

    if (forcarResetPorDica) {
        deveFazerErosao = true;
        maxCiclosDestaSessao = 3;
        document.getElementById('faseStatus').innerText = "Reinício por Dica (Erosão)";
        document.getElementById('faseStatus').className = "badge bg-danger text-white me-1";
    } else if (isVirgem) {
        deveFazerErosao = true;
        maxCiclosDestaSessao = 3;
        document.getElementById('faseStatus').innerText = "Novo Card (Erosão)";
        document.getElementById('faseStatus').className = "badge bg-primary text-white me-1";
    } else {
        if (nivelAtual >= 8) { 
            deveFazerErosao = false;
            maxCiclosDestaSessao = 1;
            document.getElementById('faseStatus').innerText = `Revisão Rápida (Nível ${nivelAtual})`;
        } else if (nivelAtual >= 4) {
            deveFazerErosao = false;
            maxCiclosDestaSessao = 3;
            document.getElementById('faseStatus').innerText = `Revisão Média (Nível ${nivelAtual})`;
        } else {
            deveFazerErosao = true;
            maxCiclosDestaSessao = 3;
            document.getElementById('faseStatus').innerText = `Revisão Crítica (Nível ${nivelAtual})`;
        }
        document.getElementById('faseStatus').className = "badge bg-warning text-dark me-1";
    }

    if (deveFazerErosao) proximaRodadaErosao();
    else iniciarModoFinal();
}

function proximaRodadaErosao() {
    let disponiveis = indicesPalavrasUteis.filter(i => !indicesOcultosAcumulados.includes(i));
    if (disponiveis.length > 0) {
        const randIndex = Math.floor(Math.random() * disponiveis.length);
        indicesOcultosAcumulados.push(disponiveis[randIndex]);
        document.getElementById('infoBadge').innerText = `Ocultas: ${indicesOcultosAcumulados.length}/${indicesPalavrasUteis.length}`;
        renderizarTexto();
        atualizarBarraProgresso();
    } else {
        iniciarModoFinal();
    }
}

function iniciarModoFinal() {
    modoFinalAtivo = true;
    cicloFinal++; 
    indicePalavraEsperadaNoModoFinal = 0;
    wordsData.forEach(w => w.reveladaNoCiclo = false);
    
    document.getElementById('faseStatus').innerText = `Consolidação (${cicloFinal}/${maxCiclosDestaSessao})`;
    document.getElementById('faseStatus').className = "badge bg-danger me-1";
    document.getElementById('infoBadge').innerText = "Modo Cego";
    renderizarTexto();
    atualizarBarraProgresso();
}

function atualizarBarraProgresso() {
    let pct = 0;
    if (modoFinalAtivo) {
        const porCiclo = 100 / maxCiclosDestaSessao; 
        const noCiclo = (indicePalavraEsperadaNoModoFinal / wordsData.length) * porCiclo;
        pct = ((cicloFinal - 1) * porCiclo) + noCiclo;
    } else {
        if(indicesPalavrasUteis.length > 0) pct = (indicesOcultosAcumulados.length / indicesPalavrasUteis.length) * 100;
    }
    pct = Math.min(100, pct);
    document.getElementById('progressBarEstudo').style.width = `${pct}%`;
    document.getElementById('labelProgresso').innerText = `${Math.floor(pct)}%`;
}

function renderizarTexto() {
    const display = document.getElementById('textDisplay');
    display.innerHTML = wordsData.map((obj, idx) => {
        if (modoFinalAtivo) {
            if (obj.reveladaNoCiclo) return `<span class="word is-correct">${obj.original}</span>`;
            return `<span class="word final-hidden"></span>`;
        } else {
            if (obj.isConnector) return `<span class="word connector">${obj.original}</span>`;
            if (indicesOcultosAcumulados.includes(idx)) {
                const width = Math.max(30, obj.original.length * 9); 
                return `<span class="word hidden-word" id="word-${idx}" style="min-width: ${width}px" data-clean="${obj.clean}"></span>`;
            }
            return `<span class="word">${obj.original}</span>`;
        }
    }).join('');
}

// ==========================================
// 10. INPUT E EVENTOS
// ==========================================
document.addEventListener('DOMContentLoaded', function() {
    carregarTema();
    sanitizarBancoDeDados();

    const userInput = document.getElementById('userInput');
    if (userInput) {
        userInput.addEventListener('input', function() { checkInput(this); });
        userInput.addEventListener('keydown', function(e) {
            if (e.key === "Enter" || e.key === " ") {
                if(e.key === " ") e.preventDefault();
                checkInput(this, true);
            }
        });
    }

    renderizarPastas();
    atualizarDashboard();
});

function checkInput(inputEl, forceValidation = false) {
    const val = normalizar(inputEl.value);
    if (!val) return;

    if (modoFinalAtivo) {
        if (indicePalavraEsperadaNoModoFinal < wordsData.length) {
            const target = wordsData[indicePalavraEsperadaNoModoFinal];
            if (val === target.clean) {
                totalAcertos++;
                target.reveladaNoCiclo = true;
                indicePalavraEsperadaNoModoFinal++;
                inputEl.value = "";
                renderizarTexto();
                atualizarBarraProgresso();
                
                if (indicePalavraEsperadaNoModoFinal >= wordsData.length) {
                    if (cicloFinal < maxCiclosDestaSessao) setTimeout(iniciarModoFinal, 50);
                    else setTimeout(finalizarSessaoCard, 50);
                }
            } else if (forceValidation) {
                registrarErro(inputEl.value, target.clean);
                inputEl.value = "";
            }
        }
    } else {
        const matchIndex = indicesOcultosAcumulados.find(idx => {
            const el = document.getElementById(`word-${idx}`);
            return el && el.classList.contains('hidden-word') && wordsData[idx].clean === val;
        });

        if (matchIndex !== undefined) {
            const el = document.getElementById(`word-${matchIndex}`);
            el.classList.remove('hidden-word');
            el.classList.add('is-correct');
            el.innerText = wordsData[matchIndex].original;
            totalAcertos++;
            inputEl.value = "";
            
            if (document.querySelectorAll('.hidden-word').length === 0) setTimeout(proximaRodadaErosao, 50);
        } else if (forceValidation) {
            registrarErro(inputEl.value, "palavra oculta");
            inputEl.value = "";
        }
    }
    atualizarWinrate();
}

function registrarErro(digitado, esperado) {
    totalErros++;
    listaErros.add(`${digitado} (era: ${esperado})`);
    document.getElementById('errorArea').classList.remove('d-none');
    document.getElementById('errorList').innerHTML = Array.from(listaErros).map(e => `<li>${e}</li>`).join('');
    atualizarWinrate();
}

function atualizarWinrate() {
    const total = totalAcertos + totalErros;
    const perc = total === 0 ? 100 : Math.round((totalAcertos / total) * 100);
    const display = document.getElementById('winratePerc');
    display.innerText = `${perc}%`;
    display.className = perc < 60 ? "text-danger fw-bold" : "text-success fw-bold";
}

function usarDica() {
    if (!cardAtivoRef) return;
    totalErros += 5; 
    atualizarWinrate();
    document.getElementById('fullTextHint').innerText = cardAtivoRef.texto;
    if (!bootstrapModal) bootstrapModal = new bootstrap.Modal(document.getElementById('hintModal'));
    bootstrapModal.show();
}

function estouPronto() {
    if (bootstrapModal) bootstrapModal.hide();
    document.getElementById('userInput').value = "";
    document.getElementById('userInput').focus();
    prepararTreino(cardAtivoRef.texto, true);
}

function finalizarSessaoCard() {
    clearInterval(cronometroInterval);
    cardAtivoRef.nivel = 10;
    cardAtivoRef.ultimoEstudo = Date.now();
    cardAtivoRef.tempoEstudo = (cardAtivoRef.tempoEstudo || 0) + segundosCardAtual;
    const total = totalAcertos + totalErros;
    cardAtivoRef.winrate = Math.round((totalAcertos / (total || 1)) * 100);
    salvarDB();
    alert("🏆 Sessão Concluída! Nível 10 atingido.");
    voltarAoDashboard();
}

function exportarBackup() {
    const dataStr = JSON.stringify(db, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', 'backup_legismemoria.json');
    linkElement.click();
}

function triggerImport() { document.getElementById('fileInput').click(); }
function importarBackup(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const json = JSON.parse(e.target.result);
            if (json && Array.isArray(json.pastas)) {
                db = json;
                sanitizarBancoDeDados(); 
                salvarDB();
                alert("Backup restaurado!");
                location.reload(); 
            } else alert("Arquivo inválido.");
        } catch(err) { alert("Erro ao ler arquivo: " + err.message); }
    };
    reader.readAsText(file);
}