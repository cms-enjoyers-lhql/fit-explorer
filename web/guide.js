import { ROOFIT_SAVE_CODE, ROOFIT_USAGE_CODE, ROOFIT_INSTRUCTIONS } from './roofit_example.js';
import { downloadExampleRoot } from './root_io.js';

const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const snippets={instructions:ROOFIT_INSTRUCTIONS,'roofit-code':ROOFIT_SAVE_CODE,'roofit-usage':ROOFIT_USAGE_CODE};
const copyButton=(key,label)=>`<button class="button" data-copy="${key}" aria-label="${label}">${label}</button>`;
const codeBlock=(key,label,text)=>`<div class="guide-code"><div class="guide-code-toolbar"><span>${label}</span>${copyButton(key,'Copy code')}</div><pre><code data-copy-source="${key}">${escape(text)}</code></pre></div>`;

export function guideHTML() {
  return `<div class="guide-content">
    <header class="guide-heading"><span class="section-label">ROOT / version 1</span><h1>Open a ROOT fit</h1>
      <p>One <code>fit.root</code> file contains the fitted model, data, covariance and display tables.</p>
      <div class="guide-actions"><button class="button primary" data-guide-choose>Choose ROOT</button><button class="button" data-download-example>Download example ROOT</button>${copyButton('instructions','Copy instructions')}</div>
      <p class="copy-status" data-copy-status role="status" aria-live="polite"></p>
    </header>
    <section><h2>1. Open your fit</h2><p>Drop your <code>.root</code> file anywhere in the viewer, or click <strong>Load FIT</strong> to choose it. Files saved with the function below open directly in the viewer. Reading stays on your computer and works offline.</p>
      <p><strong>Download example ROOT</strong> gives a fitted, explicitly synthetic example: 12,000 events, a two-head Gaussian peak near 0.5 and a power-law background. Load that same file to explore its fitted yields and nested components.</p></section>
    <section class="roofit-saving"><h2>2. Save from RooFit</h2>
      <p>Call <code>save_fit_root</code> after your fit, while the model still holds the fitted parameter values. It discovers components in your fitted extended model, writes their hierarchy into the ROOT file and prepares the display tables without rerunning the fit.</p>
      <p><strong>Copy instructions</strong> copies the contract, saving function and call template for your fitting code or coding assistant.</p>
      <details class="roofit-code-details"><summary>PyROOT saving function</summary>${codeBlock('roofit-code','Reusable ROOT saving function',ROOFIT_SAVE_CODE)}</details>
      <details><summary>Example: call it after your existing fit</summary><p>Paste the saving function first, then replace the object variables below with those from your code. Their actual ROOT names are retained.</p>${codeBlock('roofit-usage','Call template',ROOFIT_USAGE_CODE)}</details>
    </section>
    <section><h2>3. What belongs inside fit.root?</h2>
      <table><thead><tr><th>ROOT object</th><th>Contents</th></tr></thead><tbody>
        <tr><td><code>workspace</code><br>RooWorkspace</td><td>The full PDF graph, component PDFs, absolute yield objects, both observables and their ranges, fixed/free parameters, and fitted data.</td></tr>
        <tr><td><code>best_fit</code><br>Workspace snapshot</td><td>Parameter values at the saved result. The saving function checks their values and fixed/free flags.</td></tr>
        <tr><td><code>fit_result</code><br>RooFitResult</td><td>Parameter errors, full covariance/correlations and fit quality. Keep the result returned by your existing fit with <code>Save=True</code>.</td></tr>
        <tr><td><code>fit_explorer/</code><br>Native ROOT directory</td><td>Observed and expected TH2 bin counts, component yields/errors, parameter tables, axis labels/units, count-error tables and smooth projection samples. The saving function writes this directory.</td></tr>
      </tbody></table>
      <p>The browser reads the native display objects directly. Keep them alongside the workspace in the same file so the complete fit opens without executing custom PDF code in the browser. A workspace saved on its own needs the display directory added by the saving function.</p>
    </section>
    <section><h2>4. Model and normalization</h2>
      <p>Component names and their number come from the ROOT model. Extended <code>RooAddPdf</code> mixtures and <code>RooExtendPdf</code> wrappers provide yields; nested additive mixtures become expandable children with errors propagated from the full saved covariance. <code>RooProdPdf</code> factors form one shape and are not counted as separate event categories.</p>
      <p>Automatic discovery uses the full rectangular observable domain and checks that nested yields and display tables sum to their parent. Restricted domains or unusual coefficient normalization require an explicit matching adapter. When specifying components manually, supply absolute yields in the declared domain. Display values are expected candidates per bin. They are never rescaled to match the observed total. Preserve the RooFitResult covariance and fixed parameters.</p>
      <p>Use the original axis order, labels and units. Unit-weight counts are supported by the current renderer; weighted data and special normalization domains need a matching adapter. For custom C++ PDFs, embed their source or retain the matching library for later native ROOT use.</p>
    </section>
    <section><h2>Display controls</h2>
      <p><strong>3D log minimum</strong> controls the height baseline; lower it to inspect weak components. Projection scales are independent. Counts and fit parameters remain unchanged.</p>
      <p>Both projections use the same selected stripe or rectangle. Drag a dashed boundary to resize the window, or drag inside it with the hand cursor to move it. The other mass window is preserved. Inspector yields refer to the full saved fit.</p>
      <p>Returning from this guide preserves the camera, selected components and slice.</p>
    </section>
  </div>`;
}

async function copyText(text) {
  try {
    if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);return true}
  }catch{} // Offline file:// and denied clipboard permissions use the fallback.
  const active=document.activeElement,area=document.createElement('textarea');
  area.value=text;area.readOnly=true;area.style.cssText='position:fixed;left:-10000px;top:0;';
  document.body.appendChild(area);
  try {area.focus({preventScroll:true});area.select();return document.execCommand('copy')}
  catch{return false}
  finally{area.remove();active?.focus?.({preventScroll:true})}
}

export function bindGuide(container,{onChooseFile,onLoadExample}={}) {
  const controller=new AbortController();
  container.addEventListener('click',async event=>{
    const button=event.target.closest('[data-copy]');
    if(button){
      const key=button.dataset.copy;
      if(!Object.hasOwn(snippets,key))return;
      const label=button.textContent,status=container.querySelector('[data-copy-status]');
      button.disabled=true;
      try{
        const copied=await copyText(snippets[key]);
        button.textContent=copied?'Copied':'Copy failed';
        if(status)status.textContent=copied?'Copied to clipboard.':'Clipboard unavailable. Select the code and press Ctrl/Cmd+C.';
        if(!copied){let code=container.querySelector(`[data-copy-source="${key}"]`);if(!code){const pre=document.createElement('pre');code=document.createElement('code');code.dataset.copySource=key;code.textContent=snippets[key];pre.appendChild(code);container.querySelector('.guide-heading').appendChild(pre)}if(code){const details=code.closest('details');if(details)details.open=true;const range=document.createRange();range.selectNodeContents(code);const selection=getSelection();selection.removeAllRanges();selection.addRange(range)}}
        setTimeout(()=>{button.textContent=label},1800);
      }finally{button.disabled=false}
      return;
    }
    if(event.target.closest('[data-download-example]'))downloadExampleRoot();
    if(event.target.closest('[data-guide-choose]')){
      if(onChooseFile)onChooseFile();else container.querySelector('input[type=file]')?.click();
    }
  },{signal:controller.signal});
  return ()=>controller.abort();
}
