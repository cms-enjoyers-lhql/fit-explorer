#!/usr/bin/env python3
"""Generate and fit an explicitly synthetic RooFit example; synthetic data only."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import time


def make_model(R):
    x=R.RooRealVar('mass_a','m_{A}',.08,.92,'GeV')
    y=R.RooRealVar('mass_b','m_{B}',.08,.92,'GeV')
    parameters=[]
    def var(name,title,value,lo,hi):
        item=R.RooRealVar(name,title,value,lo,hi);parameters.append(item);return item
    ax=var('mean_core_a','Core mean A',.47,.43,.50)
    ay=var('mean_core_b','Core mean B',.53,.49,.59)
    asx=var('sigma_core_a','Core width A',.026,.015,.045)
    asy=var('sigma_core_b','Core width B',.040,.020,.065)
    bx=var('mean_shoulder_a','Shoulder mean A',.555,.51,.62)
    by=var('mean_shoulder_b','Shoulder mean B',.46,.41,.49)
    bsx=var('sigma_shoulder_a','Shoulder width A',.043,.022,.070)
    bsy=var('sigma_shoulder_b','Shoulder width B',.029,.015,.050)
    gx1=R.RooGaussian('core_a','Core Gaussian A',x,ax,asx)
    gy1=R.RooGaussian('core_b','Core Gaussian B',y,ay,asy)
    gx2=R.RooGaussian('shoulder_a','Shoulder Gaussian A',x,bx,bsx)
    gy2=R.RooGaussian('shoulder_b','Shoulder Gaussian B',y,by,bsy)
    core=R.RooProdPdf('gaussian_core','Gaussian head 1',R.RooArgSet(gx1,gy1))
    shoulder=R.RooProdPdf('gaussian_shoulder','Gaussian head 2',R.RooArgSet(gx2,gy2))
    fraction=var('fraction_core','Head 1 fraction',.62,.15,.90)
    peak=R.RooAddPdf('twin_peak','Twin Gaussian peak',R.RooArgList(core,shoulder),R.RooArgList(fraction))
    alpha=var('power_a','Power exponent A',.70,-.5,2.5)
    beta=var('power_b','Power exponent B',-.25,-.8,1.5)
    pa=R.RooGenericPdf('power_shape_a','Power law A','pow(@0,@1)',R.RooArgList(x,alpha))
    pb=R.RooGenericPdf('power_shape_b','Power law B','pow(@0,@1)',R.RooArgList(y,beta))
    background=R.RooProdPdf('power_background','Power-law background',R.RooArgSet(pa,pb))
    npeak=var('N_peak','Twin peak yield',4800.,0.,20000.)
    nbackground=var('N_background','Power background yield',7200.,0.,20000.)
    model=R.RooAddPdf('demo_model','Synthetic twin-peak model',R.RooArgList(peak,background),R.RooArgList(npeak,nbackground))
    return dict(x=x,y=y,model=model,core=core,shoulder=shoulder,peak=peak,background=background,
                parameters=parameters,keep=[gx1,gy1,gx2,gy2,pa,pb,fraction,npeak,nbackground])


def native_plots(R,w,result,output):
    model=w.pdf('demo_model');data=w.data('toy_data');keep=[]
    canvas=R.TCanvas('synthetic_fit_projections','Synthetic example - native RooFit',1800,1100)
    canvas.SetFillColor(0)
    legend=None
    for k,name in enumerate(('mass_a','mass_b')):
        x=w.var(name);left=.01+k*.50;right=.49+k*.50
        top=R.TPad('top_'+str(k),'',left,.30,right,.91)
        bottom=R.TPad('pull_'+str(k),'',left,.055,right,.30)
        top.SetLeftMargin(.11);top.SetRightMargin(.025);top.SetBottomMargin(.025)
        bottom.SetLeftMargin(.11);bottom.SetRightMargin(.025);bottom.SetBottomMargin(.29);bottom.SetTopMargin(.035)
        canvas.cd();top.Draw();bottom.Draw();top.cd()
        frame=x.frame(R.RooFit.Bins(60));frame.SetTitle('')
        data.plotOn(frame,R.RooFit.Name('data'))
        model.plotOn(frame,R.RooFit.Name('model'),R.RooFit.Normalization(1.,R.RooAbsReal.RelativeExpected),R.RooFit.LineColor(R.kRed+1),R.RooFit.LineWidth(3))
        pull=frame.pullHist('data','model')
        for pdf,tag,color,style in [('power_background','background',R.kGreen+2,2),('twin_peak','peak',R.kBlue+1,1),('gaussian_core','head1',R.kAzure+7,7),('gaussian_shoulder','head2',R.kViolet+1,7)]:
            model.plotOn(frame,R.RooFit.Components(pdf),R.RooFit.Name(tag),R.RooFit.Normalization(1.,R.RooAbsReal.RelativeExpected),R.RooFit.LineColor(color),R.RooFit.LineStyle(style),R.RooFit.LineWidth(2))
        frame.GetYaxis().SetTitle('Events / bin');frame.GetYaxis().SetTitleOffset(1.25);frame.GetXaxis().SetLabelSize(0);frame.GetXaxis().SetTitle('')
        frame.Draw();keep.extend([frame,pull,top,bottom])
        if k==0:
            legend=R.TLegend(.13,.60,.51,.91);legend.SetBorderSize(0);legend.SetFillStyle(0);legend.SetTextSize(.033)
            for key,label,opt in [('data','Generated data','pe'),('model','Fitted total','l'),('peak','Twin Gaussian peak','l'),('head1','Gaussian head 1','l'),('head2','Gaussian head 2','l'),('background','Power-law background','l')]:legend.AddEntry(frame.findObject(key),label,opt)
            legend.Draw();keep.append(legend)
        else:
            label=R.TLatex();label.SetNDC(True);label.SetTextSize(.029);label.SetTextFont(42)
            n=w.var('N_peak');b=w.var('N_background');f=w.var('fraction_core')
            for j,text in enumerate([f'N_{{peak}} = {n.getVal():.1f} #pm {n.getError():.1f}',f'N_{{background}} = {b.getVal():.1f} #pm {b.getError():.1f}',f'f_{{head 1}} = {f.getVal():.3f} #pm {f.getError():.3f}',f'status = {result.status()}, covQual = {result.covQual()}']):label.DrawLatex(.68,.84-j*.065,text)
            keep.append(label)
        bottom.cd();pframe=x.frame();pframe.SetTitle('');pframe.addPlotable(pull,'P')
        pframe.GetYaxis().SetTitle('Pull');pframe.GetYaxis().SetNdivisions(505);pframe.GetYaxis().SetTitleSize(.12);pframe.GetYaxis().SetLabelSize(.10);pframe.GetYaxis().SetTitleOffset(.42)
        pframe.GetXaxis().SetTitle(x.GetTitle()+' [GeV]');pframe.GetXaxis().SetTitleSize(.12);pframe.GetXaxis().SetLabelSize(.10)
        pframe.SetMinimum(-4.)
        pframe.SetMaximum(4.);pframe.Draw();line=R.TLine(x.getMin(),0,x.getMax(),0);line.SetLineStyle(2);line.SetLineColor(R.kGray+2);line.Draw();keep.extend([pframe,line])
    canvas.cd();title=R.TLatex();title.SetNDC(True);title.SetTextFont(42);title.SetTextSize(.027)
    title.DrawLatex(.035,.965,'SYNTHETIC EXAMPLE  |  Twin Gaussian peak + power-law background')
    title.SetTextSize(.021);title.DrawLatex(.035,.93,'12,000 generated events; fixed component counts; seed 20261118. Synthetic data only.')
    canvas.SaveAs(str(output/'fit-projections.png'))
    file=R.TFile.Open(str(output/'fit-projections.root'),'CREATE');canvas.Write();file.Close()
    return canvas,keep


def attach_demo_metadata(R,path,truth,counts,seed,canvas=None):
    """Keep generation truth and optional native plot in the same delivered file."""
    file=R.TFile.Open(str(path),'UPDATE');workspace=file.Get('workspace')
    for name,value in truth.items():workspace.var(name).setVal(value)
    workspace.saveSnapshot('generation_truth',workspace.pdf('demo_model').getParameters(workspace.data('toy_data')))
    assert workspace.loadSnapshot('best_fit');workspace.Write('workspace',R.TObject.kOverwrite)
    R.TParameter('int')('generation_seed',seed).Write('generation_seed',R.TObject.kOverwrite)
    R.TNamed('sample_kind','synthetic_generated_and_fitted; fixed leaf counts; synthetic data only').Write('sample_kind',R.TObject.kOverwrite)
    directory=file.GetDirectory('generation_counts') or file.mkdir('generation_counts')
    for name,count in counts.items():directory.WriteObject(R.TParameter('int')(name,count),name,'Overwrite')
    if canvas:file.cd();canvas.Write('native_fit_projections',R.TObject.kOverwrite)
    file.Close()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--fit-only',action='store_true',help='Save native fit first; defer display-table export')
    args=parser.parse_args();output=args.output.resolve();output.mkdir(parents=True,exist_ok=False)
    import ROOT as R
    R.gROOT.SetBatch(True);R.RooMsgService.instance().setGlobalKillBelow(R.RooFit.WARNING)
    R.RooAbsReal.defaultIntegratorConfig().setEpsAbs(1e-11);R.RooAbsReal.defaultIntegratorConfig().setEpsRel(1e-10)
    seed=20261118;R.RooRandom.randomGenerator().SetSeed(seed)
    parts=make_model(R);x,y,model=parts['x'],parts['y'],parts['model'];observables=R.RooArgSet(x,y)
    truth={v.GetName():float(v.getVal())for v in parts['parameters']}
    counts={'gaussian_core':2976,'gaussian_shoulder':1824,'power_background':7200}
    generated=[parts[key].generate(observables,n)for key,n in [('core',2976),('shoulder',1824),('background',7200)]]
    category=R.RooCategory('generated_component','True generated component')
    data=R.RooDataSet('toy_data','Synthetic fixed-count generated data',observables,R.RooFit.Index(category),R.RooFit.Import('gaussian_core',generated[0]),R.RooFit.Import('gaussian_shoulder',generated[1]),R.RooFit.Import('power_background',generated[2]))
    assert data.numEntries()==12000 and not data.isWeighted()
    starts={'mean_core_a':.465,'mean_core_b':.535,'sigma_core_a':.030,'sigma_core_b':.044,'mean_shoulder_a':.560,'mean_shoulder_b':.455,'sigma_shoulder_a':.047,'sigma_shoulder_b':.033,'fraction_core':.55,'power_a':.4,'power_b':-.1,'N_peak':4400.,'N_background':7600.}
    for v in parts['parameters']:v.setVal(starts[v.GetName()])
    started=time.monotonic();result=model.fitTo(data,R.RooFit.Save(True),R.RooFit.Extended(True),R.RooFit.Minimizer('Minuit2','migrad'),R.RooFit.Strategy(1),R.RooFit.PrintLevel(-1),R.RooFit.NumCPU(1))
    quality=dict(status=int(result.status()),covariance_quality=int(result.covQual()),edm=float(result.edm()),min_nll=float(result.minNll()))
    fitted={v.GetName():{'value':float(v.getVal()),'error':float(v.getError()),'truth':truth[v.GetName()]}for v in result.floatParsFinal()}
    boundary=[v.GetName()for v in result.floatParsFinal()if min(v.getVal()-v.getMin(),v.getMax()-v.getVal())<1e-5*(v.getMax()-v.getMin())]
    report=dict(kind='synthetic_generated_and_fitted',seed=seed,events=data.numEntries(),generation='fixed leaf counts; native RooFit generate',generated_component_counts=counts,quality=quality,fit_seconds=time.monotonic()-started,parameters=fitted,boundary_parameters=boundary,new_minimizations=1,synthetic_only=True)
    (output/'fit-report.json').write_text(json.dumps(report,indent=2)+'\n')
    w=R.RooWorkspace('workspace');getattr(w,'import')(model);getattr(w,'import')(data);w.saveSnapshot('best_fit',w.pdf('demo_model').getParameters(w.data('toy_data')))
    for name,value in truth.items():w.var(name).setVal(value)
    w.saveSnapshot('generation_truth',w.pdf('demo_model').getParameters(w.data('toy_data')));assert w.loadSnapshot('best_fit')
    file=R.TFile.Open(str(output/'model-fit.root'),'CREATE');w.Write();result.Write('fit_result');R.TParameter('int')('generation_seed',seed).Write();R.TNamed('sample_kind','synthetic_generated_and_fitted').Write();file.Close()
    canvas,plot_keep=native_plots(R,w,result,output)
    print(json.dumps({'status':'PASS'if quality['status']==0 and quality['covariance_quality']==3 and not boundary else 'FAIL','output':str(output),'quality':quality,'boundary':boundary,'N_peak':fitted['N_peak'],'N_background':fitted['N_background']},indent=2),flush=True)
    if quality['status']!=0 or quality['covariance_quality']!=3 or boundary:raise RuntimeError('Synthetic fit quality gate failed; preserve this run for diagnosis')
    if not args.fit_only:
        from .io import save_fit_root
        save_fit_root(output/'fit.root',model=w.pdf('demo_model'),data=w.data('toy_data'),result=result,axes=[(w.var('mass_a'),'m(A)','GeV'),(w.var('mass_b'),'m(B)','GeV')],bins=60,sample_points=601,title='SYNTHETIC · twin Gaussian peak + power-law background',channel='synthetic')
        attach_demo_metadata(R,output/'fit.root',truth,counts,seed,canvas)


if __name__=='__main__':main()
