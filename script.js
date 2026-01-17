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
let modoFinalAtivo = false; // False = Erosão, True = Consolidação
let cicloFinal = 0; 
let indicePalavraEsperadaNoModoFinal = 0;

// Stats
let totalAcertos = 0;
let totalErros = 0;
let segundosCardAtual = 0;
let cronometroInterval = null;
let bootstrapModal = null;
let chartDist = null;
let chartBar = null;

const stopWords = ["a", "o", "as", "os", "de", "do", "da", "dos", "das", "e", "em", "um", "uma", "uns", "umas", "com", "por", "para", "que", "se", "no", "na", "nos", "nas", "ao", "aos", "pelo", "pela", "pelos", "pelas", "ou", "é", "são", "foi", "nao", "não"];

// ==========================================
// 2. SANITIZAÇÃO E UTILITÁRIOS
// ==========================================

function sanitizarBancoDeDados() {
    let houveMudanca = false;
    db.pastas.forEach(p => {
        p.cards.forEach(c => {
            if (c.nivel > 10) { c.nivel = 10; houveMudanca = true; }
            if (c.nivel < 0) { c.nivel = 0; houveMudanca = true; }
        });
    });
    
    if (houveMudanca) {
        salvarDB();
        console.log("Banco de dados corrigido.");
    }
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
// 3. LÓGICA DE DECAIMENTO (PONDERADA - 72H TOTAL)
// ==========================================
function getDadosDecaimento(card) {
    // CONFIGURAÇÃO DOS PESOS (Total 72h)
    // High (Lvl 9, 10): 14.4h cada
    // Mid (Lvl 5-8): 7.2h cada
    // Low (Lvl 1-4): 3.6h cada
    const duracaoPorNivel = {
        10: 14.4, 9: 14.4,
        8: 7.2, 7: 7.2, 6: 7.2, 5: 7.2,
        4: 3.6, 3: 3.6, 2: 3.6, 1: 3.6
    };

    const nivelSalvo = Math.min(10, Math.max(0, card.nivel || 0));
    
    // Se nunca estudou ou nível 0
    if (!card.ultimoEstudo || (nivelSalvo === 0 && !card.ultimoEstudo)) {
        return { nivelInt: 0, estabilidade: "0.0", msParaQueda: 0 };
    }

    const agora = Date.now();
    const horasPassadas = (agora - card.ultimoEstudo) / (1000 * 60 * 60);

    // Simula a queda nível por nível
    let nivelAtual = nivelSalvo;
    let tempoRestanteParaDeduzir = horasPassadas;
    let msParaQueda = 0;
    let porcentagemEstabilidade = 0;

    // Loop de consumo do tempo
    while (nivelAtual > 0) {
        const duracaoDesteNivel = duracaoPorNivel[nivelAtual];
        
        if (tempoRestanteParaDeduzir < duracaoDesteNivel) {
            // O tempo parou DENTRO deste nível
            const horasParaCair = duracaoDesteNivel - tempoRestanteParaDeduzir;
            msParaQueda = horasParaCair * 60 * 60 * 1000;
            
            // Calcula % visual (100% = acabou de entrar no nível, 0% = vai cair)
            const ratio = horasParaCair / duracaoDesteNivel;
            porcentagemEstabilidade = ratio * 100;
            
            break; 
        } else {
            // Consumiu o nível todo, cai para o próximo
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
// 4. UI - NAVEGAÇÃO
// ==========================================
function esconderTodasTelas() {
    document.getElementById('dashboardArea').classList.add('d-none');
    document.getElementById('setupArea').classList.add('d-none');
    document.getElementById('trainingArea').classList.add('d-none');
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
// 5. CRUD PASTAS
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

// ==========================================
// 6. CRUD CARDS
// ==========================================
function renderizarCards() {
    const lista = document.getElementById('listaCards');
    if (pastaAtivaIdx === null) { lista.innerHTML = ""; return; }
    
    const cards = db.pastas[pastaAtivaIdx].cards;
    document.getElementById('contagemCards').innerText = `${cards.length} cards`;
    
    lista.innerHTML = cards.map(c => {
        const dados = getDadosDecaimento(c);
        let corBadge = 'bg-danger';
        if (dados.nivelInt >= 9) corBadge = 'bg-success';
        else if (dados.nivelInt >= 5) corBadge = 'bg-warning text-dark';
        
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
            // Edição reseta para nível 0? Depende da sua preferência. 
            // Aqui mantemos resetado para forçar re-estudo se mudou o texto.
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
// 7. DASHBOARD
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
            
            if (dados.nivelInt < 5) nCritico++;
            else if (dados.nivelInt < 9) nAtencao++;
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
                titulo: c.titulo, 
                pasta: p.nome, 
                nivelInt: dados.nivelInt,
                estabilidade: dados.estabilidade, 
                msParaQueda: dados.msParaQueda,
                isZero: dados.nivelInt === 0
            });
        });
    });

    // Ordena por estabilidade (menor = mais urgente)
    lista.sort((a,b) => parseFloat(a.estabilidade) - parseFloat(b.estabilidade));
    
    const container = document.getElementById('dashDecaimento');
    if (lista.length === 0) {
        container.innerHTML = '<div class="list-group-item text-center text-muted">Nenhum card criado.</div>';
    } else {
        container.innerHTML = lista.slice(0, 6).map(item => {
            const h = Math.floor(item.msParaQueda / 3600000);
            const m = Math.floor((item.msParaQueda % 3600000) / 60000);
            
            let cor = 'text-dark';
            let borda = 'border-warning';
            let bgBarra = 'bg-warning';

            if (item.nivelInt < 5) { 
                cor = 'text-danger'; 
                borda = 'border-danger'; 
                bgBarra = 'bg-danger';
            } else if (item.nivelInt >= 9) { 
                cor = 'text-success'; 
                borda = 'border-success'; 
                bgBarra = 'bg-success';
            }

            const relogio = item.isZero ? 
                '<span class="badge bg-danger">Estudar!</span>' : 
                `<small class="text-muted">Cai nível em: <strong>${h}h ${m}m</strong></small>`;

            return `
            <div class="list-group-item border-start border-4 ${borda}" style="margin-bottom:3px;">
                <div class="d-flex justify-content-between align-items-center">
                    <strong class="text-truncate" style="max-width:200px;">${item.titulo}</strong>
                    <div class="text-end">
                        <span class="badge ${bgBarra}">${item.estabilidade}%</span>
                        <div style="font-size: 0.7rem;" class="${cor}">Nível ${item.nivelInt}</div>
                    </div>
                </div>
                <div class="d-flex justify-content-between mt-1">
                    <small class="text-muted fst-italic">${item.pasta}</small>
                    ${relogio}
                </div>
            </div>`;
        }).join('');
    }
}

function renderizarGraficoPizza(crit, atenc, seg) {
    const ctx = document.getElementById('chartDistribuicao');
    if (chartDist) chartDist.destroy();
    chartDist = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Crítico', 'Atenção', 'Seguro'],
            datasets: [{
                data: [crit, atenc, seg],
                backgroundColor: ['#dc3545', '#ffc107', '#198754'],
                borderWidth: 0
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, animation: false }
    });
}

function renderizarGraficoBarras(dados) {
    const ctx = document.getElementById('chartBarras');
    if (chartBar) chartBar.destroy();
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
        options: { responsive: true, maintainAspectRatio: false, animation: false, scales: { y: { max: 10 } } }
    });
}

// ==========================================
// 8. MOTOR DE TREINO (Regras Definidas)
// ==========================================
function carregarCard(id) {
    cardAtivoRef = db.pastas[pastaAtivaIdx].cards.find(c => c.id === id);
    const dados = getDadosDecaimento(cardAtivoRef);
    cardAtivoRef.nivel = dados.nivelInt; // Sincroniza nível real
    
    esconderTodasTelas();
    document.getElementById('trainingArea').classList.remove('d-none');
    
    document.getElementById('tituloCardAtivo').innerText = cardAtivoRef.titulo;
    document.getElementById('nivelFixacao').innerText = `${cardAtivoRef.nivel}/10`;
    document.getElementById('errorArea').classList.add('d-none');
    
    totalAcertos = 0; totalErros = 0; listaErros.clear();
    atualizarWinrate();
    iniciarCronometro();
    prepararTreino(cardAtivoRef.texto);
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

function prepararTreino(text) {
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
    
    // REGRA DO JOGO:
    // < 5: Erosão
    // >= 5: Consolidação (Modo Cego)
    if (cardAtivoRef.nivel >= 5) {
        iniciarModoFinal();
    } else {
        document.getElementById('faseStatus').innerText = "Erosão (Nível 1-4)";
        document.getElementById('faseStatus').className = "badge bg-warning text-dark me-1";
        proximaRodadaErosao();
    }
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
        // Se acabou a erosão, finaliza (pois é nível baixo)
        finalizarSessaoCard();
    }
}

function iniciarModoFinal() {
    modoFinalAtivo = true;
    cicloFinal++; 
    indicePalavraEsperadaNoModoFinal = 0;
    wordsData.forEach(w => w.reveladaNoCiclo = false);
    
    // REGRA DE CICLOS:
    // Nível 9 ou 10: 1 Ciclo
    // Nível 5 a 8: 3 Ciclos
    const maxCiclos = cardAtivoRef.nivel >= 9 ? 1 : 3;

    document.getElementById('faseStatus').innerText = `Consolidação (${cicloFinal}/${maxCiclos})`;
    document.getElementById('faseStatus').className = "badge bg-danger me-1";
    document.getElementById('infoBadge').innerText = "Modo Cego";
    renderizarTexto();
    atualizarBarraProgresso();
}

function atualizarBarraProgresso() {
    let pct = 0;
    if (modoFinalAtivo) {
        const maxCiclos = cardAtivoRef.nivel >= 9 ? 1 : 3;
        const porCiclo = 100 / maxCiclos; 
        
        const noCiclo = (indicePalavraEsperadaNoModoFinal / wordsData.length) * porCiclo;
        pct = ((cicloFinal - 1) * porCiclo) + noCiclo;
    } else {
        if(indicesPalavrasUteis.length > 0) {
            pct = (indicesOcultosAcumulados.length / indicesPalavrasUteis.length) * 100;
        }
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
// 9. INPUT E VALIDAÇÃO
// ==========================================
document.addEventListener('DOMContentLoaded', function() {
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
        // --- MODO CONSOLIDAÇÃO ---
        if (indicePalavraEsperadaNoModoFinal < wordsData.length) {
            const target = wordsData[indicePalavraEsperadaNoModoFinal];
            if (val === target.clean) {
                totalAcertos++;
                target.reveladaNoCiclo = true;
                indicePalavraEsperadaNoModoFinal++;
                inputEl.value = "";
                renderizarTexto();
                atualizarBarraProgresso();
                
                // Se terminou o texto
                if (indicePalavraEsperadaNoModoFinal >= wordsData.length) {
                    const maxCiclos = cardAtivoRef.nivel >= 9 ? 1 : 3;

                    if (cicloFinal < maxCiclos) {
                        setTimeout(iniciarModoFinal, 50); // Próximo Ciclo
                    } else {
                        setTimeout(finalizarSessaoCard, 50); // Fim
                    }
                }
            } else if (forceValidation) {
                registrarErro(inputEl.value, target.clean);
                inputEl.value = "";
            }
        }
    } else {
        // --- MODO EROSÃO ---
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
            
            if (document.querySelectorAll('.hidden-word').length === 0) {
                setTimeout(proximaRodadaErosao, 50);
            }
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
    cardAtivoRef.nivel = 0;
    cardAtivoRef.ultimoEstudo = null;
    document.getElementById('userInput').value = "";
    document.getElementById('userInput').focus();
    prepararTreino(cardAtivoRef.texto);
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

// ==========================================
// 10. IMPORTAR E EXPORTAR (BACKUP)
// ==========================================
function exportarBackup() {
    const dataStr = JSON.stringify(db, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = 'backup_legismemoria.json';
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
}

function triggerImport() {
    document.getElementById('fileInput').click();
}

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
                alert("Backup restaurado com sucesso!");
                location.reload(); 
            } else {
                alert("Arquivo inválido.");
            }
        } catch(err) {
            alert("Erro ao ler arquivo: " + err.message);
        }
    };
    reader.readAsText(file);
}