/* app/app.js - Versão Consolidada com Alerta Dinâmico e Gráficos */

let charts = {}; // Armazena instâncias do Chart.js para evitar fugas de memória
let servicoSelecionado = null;

// 1. INICIALIZAÇÃO E TEMA
document.addEventListener('DOMContentLoaded', () => {
    // Inicializar componentes do Materialize CSS
    M.Modal.init(document.querySelectorAll('.modal'));
    M.Sidenav.init(document.querySelectorAll('.sidenav'));
    
    // Recuperar e aplicar tema salvo no browser
    if (localStorage.getItem('statuspt-theme') === 'dark') {
        document.body.classList.add('dark-mode');
    }
    
    // Disparar funções iniciais
    carregarDistritos();
    verificarAlertasNacionais(); // Nova funcionalidade da Barra Dinâmica
});

function toggleTheme() { 
    document.body.classList.toggle('dark-mode'); 
    const novoTema = document.body.classList.contains('dark-mode') ? 'dark' : 'light';
    localStorage.setItem('statuspt-theme', novoTema);
    
    // Atualizar cores dos gráficos se existirem
    Object.keys(charts).forEach(s => {
        const isDark = novoTema === 'dark';
        charts[s].options.scales.y.grid.color = isDark ? '#333' : '#eee';
        charts[s].update();
    });
}

// 2. LÓGICA DA BARRA DE ALERTA DINÂMICA (NACIONAL)
async function verificarAlertasNacionais() {
    const bar = document.getElementById('dynamic-alert-bar');
    if (!bar) return;

    // Janela de tempo: últimas 2 horas
    const duasHorasAtras = new Date(Date.now() - (2 * 60 * 60 * 1000)).toISOString();

    // Query ao Supabase: Conta todos os reportes no país
    const { count, error } = await _supabase
        .from('reportes')
        .select('*', { count: 'exact', head: true })
        .gte('data_reporte', duasHorasAtras);

    if (error) {
        console.error("Erro ao verificar alertas:", error);
        return;
    }

    // Configuração visual da barra
    bar.style.display = 'block';
    bar.classList.remove('alert-danger', 'alert-warning', 'alert-success', 'alert-pulse');

    if (count >= 30) {
        bar.classList.add('alert-danger', 'alert-pulse');
        bar.innerHTML = `<i class="material-icons left" style="margin-right:8px">warning</i> 
                         ALERTA CRÍTICO: ${count} incidentes reportados em Portugal nas últimas 2h!`;
    } 
    else if (count >= 10) {
        bar.classList.add('alert-warning');
        bar.innerHTML = `<i class="material-icons left" style="margin-right:8px">error_outline</i>
                         INSTABILIDADE: Detetados ${count} problemas recentes em várias regiões.`;
    } 
    else {
        bar.classList.add('alert-success');
        bar.innerHTML = `<i class="material-icons left" style="margin-right:8px">check_circle</i>
                         SISTEMA ESTÁVEL: Sem falhas críticas detetadas no país.`;
        // Esconder após 8 segundos se estiver tudo bem para limpar o UI
        setTimeout(() => { bar.style.display = 'none'; }, 8000);
    }
}

// 3. GESTÃO DOS SELECTS (DISTRITOS > CONCELHOS > LOCALIDADES)
function cleanSelect(id, placeholder) {
    const el = document.getElementById(id);
    const inst = M.FormSelect.getInstance(el);
    if (inst) inst.destroy();
    el.innerHTML = `<option value="" disabled selected>${placeholder}</option>`;
}

async function carregarDistritos() {
    cleanSelect('distrito', 'DISTRITO');
    let { data } = await _supabase.from('distritos').select('*').order('nome');
    const s = document.getElementById('distrito');
    if(data) data.forEach(d => s.add(new Option(d.nome.toUpperCase(), d.id)));
    M.FormSelect.init(s);
}

document.getElementById('distrito').addEventListener('change', async (e) => {
    cleanSelect('concelho', 'CONCELHO');
    cleanSelect('vila', 'VILA OU ALDEIA');
    let { data } = await _supabase.from('concelhos').select('*').eq('distrito_id', e.target.value).order('nome');
    const cs = document.getElementById('concelho');
    if(data) data.forEach(c => cs.add(new Option(c.nome.toUpperCase(), c.id)));
    M.FormSelect.init(cs);
    M.FormSelect.init(document.getElementById('vila'));
});

document.getElementById('concelho').addEventListener('change', async (e) => {
    cleanSelect('vila', 'VILA OU ALDEIA');
    let { data } = await _supabase.from('localidades').select('*').eq('concelho_id', e.target.value).order('nome');
    const vs = document.getElementById('vila');
    if(data) data.forEach(v => vs.add(new Option(v.nome.toUpperCase(), v.id)));
    M.FormSelect.init(vs);
});

document.getElementById('vila').addEventListener('change', (e) => atualizarStatusLocalidade(e.target.value));

// 4. ATUALIZAÇÃO DE STATUS E GRÁFICOS (POR LOCALIDADE)
async function atualizarStatusLocalidade(id) {
    if(!id) return;
    const h24 = new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString();
    
    // Puxar reportes da localidade nas últimas 24h
    const { data: r } = await _supabase
        .from('reportes')
        .select('servico, data_reporte')
        .eq('localidade_id', id)
        .gte('data_reporte', h24);

    const counts = { luz: 0, agua: 0, net: 0, movel: 0 };
    if (r) r.forEach(x => { if(counts[x.servico] !== undefined) counts[x.servico]++; });

    ['luz', 'agua', 'net', 'movel'].forEach(s => {
        const card = document.getElementById(`card-${s}`);
        const txt = document.getElementById(`status-text-${s}`);
        
        // Determinar estado visual
        card.classList.remove('waiting', 'operational', 'warning', 'outage');
        if (counts[s] >= 5) { card.classList.add('outage'); txt.innerText = `CORTE (${counts[s]})`; }
        else if (counts[s] >= 2) { card.classList.add('warning'); txt.innerText = `INSTÁVEL (${counts[s]})`; }
        else { card.classList.add('operational'); txt.innerText = "OPERACIONAL"; }

        // Processar histórico para o gráfico (6 blocos de 4 horas)
        const reportesDoServico = r ? r.filter(item => item.servico === s) : [];
        const dadosGrafico = processarDadosParaGrafico(reportesDoServico);
        desenharGrafico(s, dadosGrafico);
    });
}

function processarDadosParaGrafico(reportes) {
    const agora = new Date();
    let blocos = [0, 0, 0, 0, 0, 0];
    reportes.forEach(r => {
        const diffHoras = (agora - new Date(r.data_reporte)) / (1000 * 60 * 60);
        const indice = Math.floor(diffHoras / 4);
        if (indice >= 0 && indice < 6) blocos[5 - indice]++;
    });
    return blocos;
}

function desenharGrafico(servico, dataPoints) {
    const ctx = document.getElementById(`chart-${servico}`).getContext('2d');
    const isDark = document.body.classList.contains('dark-mode');
    
    if (charts[servico]) charts[servico].destroy();

    charts[servico] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['', '', '', '', '', ''],
            datasets: [{
                data: dataPoints,
                borderColor: isDark ? '#ff5252' : '#d32f2f',
                borderWidth: 2,
                pointRadius: 0,
                fill: true,
                backgroundColor: isDark ? 'rgba(255, 82, 82, 0.1)' : 'rgba(211, 47, 47, 0.1)',
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: { x: { display: false }, y: { display: false, beginAtZero: true } }
        }
    });
}

// 5. REPORTE (BOTÃO MEGA PULSE)
function selecionarServico(s, el) {
    document.querySelectorAll('.report-icon-btn').forEach(b => b.style.border = "1px solid var(--border)");
    el.style.border = "2px solid #2196f3";
    servicoSelecionado = s;
}

async function enviarReporte() {
    const vId = document.getElementById('vila').value;
    if(!vId) { M.toast({html: 'ERRO: Selecione a Vila!', classes: 'red rounded'}); return; }
    if(!servicoSelecionado) { M.toast({html: 'ERRO: Selecione o serviço!', classes: 'orange rounded'}); return; }
    
    const { error } = await _supabase.from('reportes').insert([{ 
        localidade_id: vId, 
        servico: servicoSelecionado, 
        data_reporte: new Date().toISOString() 
    }]);

    if(!error) { 
        M.toast({html: 'Reporte enviado com sucesso!'}); 
        M.Modal.getInstance(document.getElementById('modalReporte')).close(); 
        atualizarStatusLocalidade(vId);
        verificarAlertasNacionais(); // Atualiza a barra global após reporte
    }
}