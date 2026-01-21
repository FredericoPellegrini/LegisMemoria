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
let chartDist = null;
let chartBar = null;

const stopWords = ["a", "o", "as", "os", "de", "do", "da", "dos", "das", "e", "em", "um", "uma", "uns", "umas", "com", "por", "para", "que", "se", "no", "na", "nos", "nas", "ao", "aos", "pelo", "pela", "pelos", "pelas", "ou", "é", "são", "foi", "nao", "não"];

// ==========================================
// 2. TEMA (MODO NOTURNO / OLEO)
// ==========================================
function alternarTema() {
    document.documentElement.classList.toggle('dark');
    const isDark = document.documentElement.classList.contains('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    
    const btn = document.getElementById('btnTema');
    if(btn) btn.innerHTML = isDark ? '<span class="material-symbols-outlined">light_mode</span>' : '<span class="material-symbols-outlined">dark_mode</span>';
    
    atualizarDashboard(); 
}

function carregarTema() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    const btn = document.getElementById('btnTema');
    
    if (savedTheme === 'dark') {
        document.documentElement.classList.add('dark');
        if(btn) btn.innerHTML = '<span class="material-symbols-outlined">light_mode</span>';
    } else {
        document.documentElement.classList.remove('dark');
        if(btn) btn.innerHTML = '<span class="material-symbols-outlined">dark_mode</span>';
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
        document.getElementById(id).classList.add('hidden');
    });
}

function voltarAoDashboard() {
    clearInterval(cronometroInterval);
    esconderTodasTelas();
    document.getElementById('dashboardArea').classList.remove('hidden');
    atualizarDashboard();
}

function mostrarSetup(isEdit = false) {
    if (pastaAtivaIdx === null) return alert("Selecione uma pasta primeiro!");
    esconderTodasTelas();
    document.getElementById('setupArea').classList.remove('hidden');
    if (!isEdit) {
        idCardEmEdicao = null;
        document.getElementById('setupTitle').innerText = "Novo Registro";
        document.getElementById('cardTitle').value = "";
        document.getElementById('rawText').value = "";
    }
}

// ==========================================
// 6. CRUD PASTAS & CARDS (Modificado para Sidebar Tree View)
// ==========================================
function criarPasta() {
    const nome = document.getElementById('novaPastaNome').value.trim();
    if (!nome) return;
    db.pastas.push({ nome: nome, cards: [] });
    salvarDB();
    document.getElementById('novaPastaNome').value = "";
    
    // Seleciona a nova pasta automaticamente
    selecionarPasta(db.pastas.length - 1);
}

function renderizarPastas() {
    const lista = document.getElementById('listaPastas');
    lista.innerHTML = db.pastas.map((p, idx) => {
        const isActive = pastaAtivaIdx === idx;
        
        // Estilos Condicionais
        const wrapperClass = isActive 
            ? 'bg-slate-50 dark:bg-white/5 border-l-4 border-primary dark:border-electric-teal' 
            : 'border-l-4 border-transparent hover:bg-slate-50 dark:hover:bg-white/5';

        const textClass = isActive
            ? 'text-primary dark:text-electric-teal font-bold'
            : 'text-slate-600 dark:text-silver';

        const iconType = isActive ? 'folder_open' : 'folder';

        // Geração da Lista de Cards (Nested/Accordion)
        let cardsHtml = '';
        if (isActive) {
            cardsHtml = `
            <div class="animate-fade-in pl-3 pr-2 pb-3 mt-1">
                <button onclick="event.stopPropagation(); mostrarSetup()" class="w-full mb-3 flex items-center justify-center gap-2 bg-primary dark:bg-electric-teal text-white dark:text-oled-black text-[10px] font-bold uppercase py-2 rounded shadow-sm hover:brightness-110 transition-all">
                    <span class="material-symbols-outlined text-[14px]">add_circle</span>
                    Novo Card
                </button>

                <div class="flex flex-col space-y-0.5">
                    ${p.cards.length === 0 ? '<p class="text-[10px] text-slate-400 text-center italic py-2">Pasta vazia</p>' : ''}
                    ${p.cards.map(c => {
                        const dados = getDadosDecaimento(c);
                        
                        // Definição da cor da bolinha (Badge) baseada no nível
                        let badgeClass = 'bg-vivid-crimson text-white';
                        if (dados.nivelInt >= 4) badgeClass = 'bg-safety-orange text-white';
                        if (dados.nivelInt >= 8) badgeClass = 'bg-emerald-500 dark:bg-emerald-400 text-white dark:text-black';

                        return `
                        <div onclick="event.stopPropagation(); carregarCard(${c.id})" class="group/card flex items-center justify-between p-2 rounded cursor-pointer hover:bg-slate-200 dark:hover:bg-white/10 transition-colors">
                            <div class="flex items-center gap-2 overflow-hidden">
                                <div class="size-5 shrink-0 ${badgeClass} rounded-full flex items-center justify-center text-[9px] font-bold shadow-sm">
                                    ${dados.nivelInt}
                                </div>
                                <span class="text-xs text-slate-700 dark:text-slate-300 font-medium truncate group-hover/card:text-primary dark:group-hover/card:text-electric-teal transition-colors">
                                    ${c.titulo}
                                </span>
                            </div>
                            <div class="flex items-center opacity-0 group-hover/card:opacity-100 transition-opacity">
                                <button onclick="event.stopPropagation(); editarCard(${c.id})" class="p-1 text-slate-400 hover:text-primary dark:hover:text-electric-teal" title="Editar">
                                    <span class="material-symbols-outlined text-[14px]">edit</span>
                                </button>
                                <button onclick="event.stopPropagation(); excluirCard(${c.id})" class="p-1 text-slate-400 hover:text-vivid-crimson" title="Excluir">
                                    <span class="material-symbols-outlined text-[14px]">delete</span>
                                </button>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }

        // HTML Principal da Pasta
        // O evento onclick está no container pai para maximizar a área de clique
        return `
        <div class="flex flex-col mb-1 ${wrapperClass} transition-colors duration-200">
            <div onclick="selecionarPasta(${idx})" class="group flex items-center justify-between px-4 py-3 cursor-pointer select-none">
                <div class="flex items-center gap-3 flex-grow overflow-hidden">
                    <span class="material-symbols-outlined text-[18px] ${textClass}">${iconType}</span>
                    <span class="text-sm truncate ${textClass}">${p.nome}</span>
                </div>
                <div class="flex gap-1 ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity">
                    <button onclick="event.stopPropagation(); editarPasta(${idx})" class="text-xs p-1 text-slate-400 hover:text-primary dark:hover:text-electric-teal">✎</button>
                    <button onclick="event.stopPropagation(); excluirPasta(${idx})" class="text-xs p-1 text-slate-400 hover:text-vivid-crimson">✕</button>
                </div>
            </div>
            ${cardsHtml}
        </div>`;
    }).join('');
}

function editarPasta(idx) {
    const novoNome = prompt("Renomear Coleção:", db.pastas[idx].nome);
    if (novoNome && novoNome.trim()) {
        db.pastas[idx].nome = novoNome.trim();
        salvarDB();
        renderizarPastas();
        if (pastaAtivaIdx === idx) {
            document.getElementById('tituloPastaAtiva').innerText = novoNome;
            document.getElementById('folderIndicator').innerText = novoNome;
        }
    }
}

function excluirPasta(idx) {
    if (confirm("Excluir coleção e todos os cards?")) {
        db.pastas.splice(idx, 1);
        pastaAtivaIdx = null;
        salvarDB();
        renderizarPastas();
        document.getElementById('tituloPastaAtiva').innerText = "Selecione";
        document.getElementById('folderIndicator').innerText = "Selecione uma pasta";
        document.getElementById('listaCards').innerHTML = ""; // Limpa a view principal
        document.getElementById('btnNovoCard').classList.add('hidden'); // Esconde botão antigo
        atualizarDashboard();
    }
}

function selecionarPasta(idx) {
    pastaAtivaIdx = idx;
    
    // Atualiza Textos
    document.getElementById('tituloPastaAtiva').innerText = db.pastas[idx].nome;
    document.getElementById('folderIndicator').innerText = db.pastas[idx].nome;
    
    // Renderiza a Sidebar (para expandir o accordion)
    renderizarPastas();
    
    // Renderiza a lista principal (caso o usuário ainda queira ver a tabela grande)
    renderizarCards();
    
    atualizarDashboard();
}

// Essa função mantém a tabela na área principal, mas agora é secundária
function renderizarCards() {
    const lista = document.getElementById('listaCards');
    if (pastaAtivaIdx === null) { lista.innerHTML = ""; return; }
    
    const cards = db.pastas[pastaAtivaIdx].cards;
    document.getElementById('contagemCards').innerText = `${cards.length} ARQUIVOS`;
    
    if (cards.length === 0) {
        lista.innerHTML = '<div class="p-8 text-center text-slate-400 dark:text-gray-600 text-sm italic">Pasta vazia. Use o botão na barra lateral para criar um card.</div>';
        return;
    }

    lista.innerHTML = `
    <table class="w-full text-left border-collapse">
        <thead>
            <tr class="bg-slate-50 dark:bg-surface-dark border-b border-slate-100 dark:border-border-thin">
                <th class="px-6 py-3 text-[10px] font-bold text-slate-400 dark:text-silver uppercase tracking-widest">Card</th>
                <th class="px-6 py-3 text-[10px] font-bold text-slate-400 dark:text-silver uppercase tracking-widest text-center">Nível</th>
            </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 dark:divide-border-thin">
            ${cards.map(c => {
                const dados = getDadosDecaimento(c);
                let progressColor = 'bg-vivid-crimson';
                if (dados.nivelInt >= 4) progressColor = 'bg-safety-orange';
                if (dados.nivelInt >= 8) progressColor = 'bg-emerald-500 dark:bg-electric-teal';
                
                return `
                <tr class="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors cursor-pointer" onclick="carregarCard(${c.id})">
                    <td class="px-6 py-4">
                        <p class="font-bold text-slate-800 dark:text-off-white text-sm">${c.titulo}</p>
                        <p class="text-[10px] text-slate-400 truncate max-w-[200px]">${c.texto.substring(0, 40)}...</p>
                    </td>
                    <td class="px-6 py-4 text-center">
                        <div class="flex items-center justify-center gap-2">
                            <div class="w-16 h-1 bg-slate-200 dark:bg-border-thin rounded-full overflow-hidden">
                                <div class="h-full ${progressColor}" style="width: ${dados.nivelInt * 10}%"></div>
                            </div>
                            <span class="text-[10px] font-bold text-slate-600 dark:text-silver">${dados.nivelInt}</span>
                        </div>
                    </td>
                </tr>`;
            }).join('')}
        </tbody>
    </table>`;
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
    renderizarPastas(); // Atualiza a sidebar
    renderizarCards(); // Atualiza a main view
    voltarAoDashboard();
}

function editarCard(id) {
    const card = db.pastas[pastaAtivaIdx].cards.find(c => c.id === id);
    if (!card) return;
    mostrarSetup(true);
    idCardEmEdicao = id;
    document.getElementById('setupTitle').innerText = "Editar Registro";
    document.getElementById('cardTitle').value = card.titulo;
    document.getElementById('rawText').value = card.texto;
}

function excluirCard(id) {
    if (confirm("Excluir card?")) {
        db.pastas[pastaAtivaIdx].cards = db.pastas[pastaAtivaIdx].cards.filter(c => c.id !== id);
        salvarDB();
        renderizarPastas(); // Atualiza a sidebar
        renderizarCards(); // Atualiza a main view
        atualizarDashboard();
    }
}

// ==========================================
// 7. DASHBOARD & RENDERIZAÇÃO DA LISTA DECAIMENTO
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
    
    const isDark = document.documentElement.classList.contains('dark');
    renderizarGraficoPizza(nCritico, nAtencao, nSeguro, isDark);
    renderizarGraficoBarras(dadosPastas, isDark);
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

    lista.sort((a,b) => {
        if (a.nivelInt !== b.nivelInt) {
            return a.nivelInt - b.nivelInt; 
        }
        return a.msParaQueda - b.msParaQueda;
    });
    
    const container = document.getElementById('dashDecaimento');
    
    if (lista.length === 0) {
        container.innerHTML = '<div class="text-center text-slate-500 text-xs py-4">Sistema sincronizado. Nenhum card em decaimento.</div>';
    } else {
        container.innerHTML = lista.map(item => {
            const h = Math.floor(item.msParaQueda / 3600000);
            const m = Math.floor((item.msParaQueda % 3600000) / 60000);
            
            let corBarra = 'bg-safety-orange';
            let tagColor = 'text-safety-orange';
            let tagText = 'ATENÇÃO';

            if (item.nivelInt < 4) { 
                corBarra = 'bg-vivid-crimson'; 
                tagColor = 'text-vivid-crimson';
                tagText = 'CRÍTICO';
            } else if (item.nivelInt >= 8) { 
                corBarra = 'bg-emerald-500 dark:bg-electric-teal';
                tagColor = 'text-emerald-500 dark:text-electric-teal';
                tagText = 'SEGURO';
            }

            const tempoTxt = item.isZero ? 'IMEDIATO' : `${h}h ${m}m`;
            
            return `
            <div class="p-3 border border-slate-200 dark:border-border-thin rounded bg-slate-50 dark:bg-oled-black/50 hover:bg-white dark:hover:bg-surface-dark transition-all cursor-pointer group" onclick="carregarCard(${item.id})">
                <div class="flex justify-between items-start mb-2">
                    <p class="text-[11px] font-bold text-slate-800 dark:text-off-white tracking-wide truncate pr-2 group-hover:text-primary dark:group-hover:text-electric-teal transition-colors">${item.titulo}</p>
                    <span class="text-[9px] ${tagColor} font-black uppercase tracking-tighter">${tagText}</span>
                </div>
                <div class="w-full h-1 bg-slate-200 dark:bg-border-thin rounded-full mb-1 overflow-hidden">
                    <div class="h-full ${corBarra} rounded-full" style="width: ${item.nivelInt * 10}%"></div>
                </div>
                <div class="flex justify-between mt-1">
                    <p class="text-[9px] text-slate-400 dark:text-silver uppercase">${item.pasta}</p>
                    <p class="text-[9px] text-slate-400 dark:text-silver">Queda: ${tempoTxt}</p>
                </div>
            </div>`;
        }).join('');
    }
}

// ==========================================
// 8. CHARTS 
// ==========================================
function renderizarGraficoPizza(crit, atenc, seg, isDark) {
    const ctx = document.getElementById('chartDistribuicao');
    if (chartDist) chartDist.destroy();
    
    const colorText = isDark ? '#A1A1AA' : '#64748b'; 
    const colors = isDark 
        ? ['#FF003D', '#FF6B00', '#00F5FF'] 
        : ['#ef4444', '#f59e0b', '#10b981']; 

    chartDist = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Crítico', 'Atenção', 'Seguro'],
            datasets: [{
                data: [crit, atenc, seg],
                backgroundColor: colors,
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { 
                legend: { 
                    position: 'right',
                    labels: { color: colorText, font: { family: 'Manrope', size: 10, weight: 'bold' }, boxWidth: 10 } 
                } 
            },
            cutout: '75%'
        }
    });
}

function renderizarGraficoBarras(dados, isDark) {
    const ctx = document.getElementById('chartBarras');
    if (chartBar) chartBar.destroy();
    
    const colorText = isDark ? '#A1A1AA' : '#64748b';
    const gridColor = isDark ? '#1F1F1F' : '#f1f5f9';
    const barColor = isDark ? '#00F5FF' : '#007180';

    chartBar = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: dados.map(d => d.nome),
            datasets: [{
                label: 'Nível Médio',
                data: dados.map(d => d.media),
                backgroundColor: barColor,
                borderRadius: 4
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            scales: { 
                y: { 
                    max: 10, 
                    ticks: { color: colorText, font: {family: 'Manrope'} }, 
                    grid: { color: gridColor, borderDash: [2, 2] },
                    border: { display: false }
                },
                x: { 
                    ticks: { color: colorText, font: {family: 'Manrope', size: 10} }, 
                    grid: { display: false },
                    border: { display: false }
                }
            },
            plugins: { legend: { display: false } }
        }
    });
}

// ==========================================
// 9. MOTOR DE TREINO
// ==========================================
function carregarCard(id) {
    let cardEncontrado = null;
    let pastaIndex = -1;

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
    document.getElementById('trainingArea').classList.remove('hidden');
    
    document.getElementById('tituloCardAtivo').innerText = cardAtivoRef.titulo;
    document.getElementById('nivelFixacao').innerText = `${cardAtivoRef.nivel}/10`;
    document.getElementById('errorArea').classList.add('hidden');
    
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

    const badgeEl = document.getElementById('faseStatus');
    badgeEl.className = "px-2 py-1 text-[10px] font-bold rounded uppercase mr-2 ";

    if (forcarResetPorDica) {
        deveFazerErosao = true;
        maxCiclosDestaSessao = 3;
        badgeEl.innerText = "Reinício por Dica";
        badgeEl.classList.add("bg-vivid-crimson", "text-white");
    } else if (isVirgem) {
        deveFazerErosao = true;
        maxCiclosDestaSessao = 3;
        badgeEl.innerText = "Novo Card";
        badgeEl.classList.add("bg-primary", "dark:bg-electric-teal", "text-white", "dark:text-black");
    } else {
        if (nivelAtual >= 8) { 
            deveFazerErosao = false;
            maxCiclosDestaSessao = 1;
            badgeEl.innerText = `Revisão Rápida`;
            badgeEl.classList.add("bg-emerald-500", "text-white");
        } else if (nivelAtual >= 4) {
            deveFazerErosao = false;
            maxCiclosDestaSessao = 3;
            badgeEl.innerText = `Revisão Média`;
            badgeEl.classList.add("bg-safety-orange", "text-white");
        } else {
            deveFazerErosao = true;
            maxCiclosDestaSessao = 3;
            badgeEl.innerText = `Revisão Crítica`;
            badgeEl.classList.add("bg-vivid-crimson", "text-white");
        }
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
    document.getElementById('errorArea').classList.remove('hidden');
    document.getElementById('errorList').innerHTML = Array.from(listaErros).map(e => `<li>${e}</li>`).join('');
    atualizarWinrate();
}

function atualizarWinrate() {
    const total = totalAcertos + totalErros;
    const perc = total === 0 ? 100 : Math.round((totalAcertos / total) * 100);
    const display = document.getElementById('winratePerc');
    display.innerText = `${perc}%`;
    display.className = perc < 60 ? "text-xl font-heading font-bold text-vivid-crimson" : "text-xl font-heading font-bold text-emerald-500 dark:text-emerald-400";
}

function usarDica() {
    if (!cardAtivoRef) return;
    totalErros += 5; 
    atualizarWinrate();
    document.getElementById('fullTextHint').innerText = cardAtivoRef.texto;
    
    const modal = document.getElementById('hintModal');
    modal.classList.remove('hidden');
}

function fecharModalDica() {
    document.getElementById('hintModal').classList.add('hidden');
}

function estouPronto() {
    fecharModalDica();
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
    
    // Atualiza a sidebar e dashboard
    renderizarPastas();
    atualizarDashboard();
    
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