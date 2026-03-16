let servicoSelecionado = null;

function toggleTheme() { 
    document.body.classList.toggle('dark-mode'); 
    localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
}

document.addEventListener('DOMContentLoaded', () => {
    // Inicializar componentes Materialize
    M.Modal.init(document.querySelectorAll('.modal'));
    M.Sidenav.init(document.querySelectorAll('.sidenav'));
    
    // Recuperar Tema
    if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark-mode');

    carregarDistritos();
});

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
});

document.getElementById('concelho').addEventListener('change', async (e) => {
    cleanSelect('vila', 'VILA OU ALDEIA');
    let { data } = await _supabase.from('localidades').select('*').eq('concelho_id', e.target.value).order('nome');
    const vs = document.getElementById('vila');
    if(data) data.forEach(v => vs.add(new Option(v.nome.toUpperCase(), v.id)));
    M.FormSelect.init(vs);
});

document.getElementById('vila').addEventListener('change', (e) => atualizarStatusLocalidade(e.target.value));

async function atualizarStatusLocalidade(id) {
    if(!id) return;
    const h = new Date(Date.now() - 3600000).toISOString();
    const { data: r } = await _supabase.from('reportes').select('servico').eq('localidade_id', id).gte('data_reporte', h);
    const count = { luz: 0, agua: 0, net: 0, movel: 0 };
    if (r) r.forEach(x => { if(count[x.servico] !== undefined) count[x.servico]++; });
    ['luz', 'agua', 'net', 'movel'].forEach(s => {
        const card = document.getElementById(`card-${s}`);
        const txt = document.getElementById(`status-text-${s}`);
        card.classList.remove('waiting', 'operational', 'warning', 'outage');
        if (count[s] >= 5) { card.classList.add('outage'); txt.innerText = `CORTE (${count[s]})`; }
        else if (count[s] >= 2) { card.classList.add('warning'); txt.innerText = `INSTÁVEL (${count[s]})`; }
        else { card.classList.add('operational'); txt.innerText = "OPERACIONAL"; }
    });
}

function selecionarServico(s, el) {
    document.querySelectorAll('.report-icon-btn').forEach(b => b.style.border = "1px solid var(--border)");
    el.style.border = "2px solid #2196f3";
    servicoSelecionado = s;
}

async function enviarReporte() {
    const vId = document.getElementById('vila').value;
    if(!vId) { M.toast({html: 'ERRO: Selecione a Vila!', classes: 'red rounded'}); return; }
    if(!servicoSelecionado) { M.toast({html: 'ERRO: Selecione o serviço!', classes: 'orange rounded'}); return; }
    const { error } = await _supabase.from('reportes').insert([{ localidade_id: vId, servico: servicoSelecionado, data_reporte: new Date().toISOString() }]);
    if(!error) { M.toast({html: 'Enviado!'}); M.Modal.getInstance(document.getElementById('modalReporte')).close(); atualizarStatusLocalidade(vId); }
}

let charts = {}; // Objeto global para gerir as instâncias dos gráficos

async function atualizarStatusLocalidade(id) {
    if(!id) return;
    
    const agora = new Date();
    const vinteQuatroHorasAtras = new Date(agora.getTime() - (24 * 60 * 60 * 1000)).toISOString();
    
    // 1. Puxar todos os reportes das últimas 24h
    const { data: reportes, error } = await _supabase
        .from('reportes')
        .select('servico, data_reporte')
        .eq('localidade_id', id)
        .gte('data_reporte', vinteQuatroHorasAtras);

    if (error) { console.error("Erro ao buscar reportes:", error); return; }

    const servicos = ['luz', 'agua', 'net', 'movel'];
    
    servicos.forEach(s => {
        const card = document.getElementById(`card-${s}`);
        const txt = document.getElementById(`status-text-${s}`);
        
        // Filtra reportes deste serviço específico
        const rServico = reportes.filter(r => r.servico === s);
        
        // Estado Atual (última 1 hora)
        const umaHoraAtras = new Date(agora.getTime() - (60 * 60 * 1000));
        const countRecente = rServico.filter(r => new Date(r.data_reporte) > umaHoraAtras).length;

        // Atualizar Visual do Card
        card.classList.remove('waiting', 'operational', 'warning', 'outage');
        if (countRecente >= 5) { card.classList.add('outage'); txt.innerText = `CORTE (${countRecente})`; }
        else if (countRecente >= 2) { card.classList.add('warning'); txt.innerText = `INSTÁVEL (${countRecente})`; }
        else { card.classList.add('operational'); txt.innerText = "OPERACIONAL"; }

        // 2. Processar Dados para o Gráfico (6 blocos de 4 horas)
        const dadosGrafico = processarDadosHistoricos(rServico);
        desenharGrafico(s, dadosGrafico);
    });
}

function processarDadosHistoricos(reportesServico) {
    const agora = new Date();
    let blocos = [0, 0, 0, 0, 0, 0]; // 6 intervalos de 4 horas
    
    reportesServico.forEach(r => {
        const dataReporte = new Date(r.data_reporte);
        const diffHoras = (agora - dataReporte) / (1000 * 60 * 60);
        
        if (diffHoras <= 24) {
            const indice = Math.floor(diffHoras / 4); // Agrupa de 4 em 4 horas
            if (indice >= 0 && indice < 6) {
                blocos[5 - indice]++; // Inverte para o gráfico ir da esquerda (antigo) para a direita (recente)
            }
        }
    });
    return blocos;
}

function desenharGrafico(servico, dataPoints) {
    const ctx = document.getElementById(`chart-${servico}`).getContext('2d');
    
    // Se já existir um gráfico, destrói para não encavalar
    if (charts[servico]) { charts[servico].destroy(); }

    charts[servico] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['', '', '', '', '', ''], // Sem labels para manter limpo
            datasets: [{
                data: dataPoints,
                borderColor: '#d32f2f',
                borderWidth: 2,
                pointRadius: 0,
                fill: true,
                backgroundColor: 'rgba(211, 47, 47, 0.1)',
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: {
                x: { display: false },
                y: { display: false, beginAtZero: true }
            }
        }
    });
}