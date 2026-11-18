"""Native storage and RooFit integration checks; no minimization or generation."""
import math
from pathlib import Path
import tempfile
import unittest

from fit_explorer.io import make_example_root, save_fit_root, standalone_saving_code
import ROOT as R
R.gROOT.SetBatch(True)
R.RooMsgService.instance().setGlobalKillBelow(R.RooFit.WARNING)


class NativeRootFormatTests(unittest.TestCase):
    def test_download_example_is_native_and_complete(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'example.root'; make_example_root(path)
            with R.TFile.Open(str(path)) as handle:
                self.assertEqual(handle.Get('fit_explorer/format').GetTitle(), 'fit-explorer.root/1')
                self.assertEqual(handle.Get('fit_explorer/observed').Integral(), 10)
                self.assertTrue(handle.Get('workspace').getSnapshot('best_fit'))
                self.assertEqual(handle.Get('workspace').data('data').sumEntries(), 10)
                self.assertAlmostEqual(sum(handle.Get('fit_explorer/components/'+key+'/yield').GetVal() for key in ('SS','SB','BS','BB')), 10)

    def fixture(self):
        x=R.RooRealVar('x','x',-5.,5.); y=R.RooRealVar('y','y',-5.,5.)
        mean=R.RooRealVar('mean','mean',0.); sigma=R.RooRealVar('sigma','sigma',1.,.1,5.)
        mean.setConstant(True);sigma.setConstant(True)
        gx=R.RooGaussian('gx','gx',x,mean,sigma);gy=R.RooGaussian('gy','gy',y,mean,sigma)
        pdfs=[R.RooProdPdf(key,key,R.RooArgList(gx,gy)) for key in ('SS','SB','BS','BB')]
        amounts=[R.RooRealVar('N_'+key,'N_'+key,2.,0.,10.)for key in ('SS','SB','BS','BB')]
        for amount in amounts:amount.setError(.5)
        model=R.RooAddPdf('model','Deterministic serialization fixture; no fit executed',R.RooArgList(*pdfs),R.RooArgList(*amounts))
        data=R.RooDataSet('data','Four deterministic points; no event generation',R.RooArgSet(x,y))
        for a,b in [(-1.,-1.),(-1.,1.),(1.,-1.),(1.,1.)]:x.setVal(a);y.setVal(b);data.add(R.RooArgSet(x,y))
        result=R.RooFitResult('fixture_result','Not a fitted result; storage test only')
        result.setFinalParList(R.RooArgList(*amounts));result.setInitParList(R.RooArgList(*amounts));result.setConstParList(R.RooArgList(mean,sigma))
        covariance=R.TMatrixDSym(4)
        for i in range(4):covariance[i][i]=.25
        result.setCovarianceMatrix(covariance)
        self.keep=[x,y,mean,sigma,gx,gy,*pdfs,*amounts,model,data,result,covariance]
        return dict(model=model,data=data,result=result,axes=[(x,'First','arb.'),(y,'Second','arb.')],components=dict(zip(('SS','SB','BS','BB'),zip(pdfs,amounts))),bins=2,sample_points=9)

    def test_exact_copied_saver_integrals_covariance_and_projection(self):
        code=standalone_saving_code();scope={};exec(compile(code,'copied-pyroot-code','exec'),scope)
        args=self.fixture()
        args['components']['SS'][1].setError(0.)  # Simulate stale workspace error.
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'fit.root';scope['save_fit_root'](path,**args)
            with R.TFile.Open(str(path)) as handle:
                self.assertEqual(handle.Get('fit_explorer/observed').Integral(),4)
                self.assertTrue(handle.Get('workspace').getSnapshot('best_fit'))
                self.assertEqual(handle.Get('fit_result').covarianceMatrix()[0][0],.25)
                for key in ('SS','SB','BS','BB'):
                    self.assertAlmostEqual(handle.Get('fit_explorer/components/'+key+'/expected').Integral(),2.,places=10)
                    self.assertAlmostEqual(handle.Get('fit_explorer/components/'+key+'/error').GetVal(),.5,places=10)
                    table=handle.Get('fit_explorer/projections/axis0/components/'+key)
                    actual=sum(table.GetBinContent(5,j)for j in (1,2))
                    expected=2.*5./math.sqrt(2*math.pi)/math.erf(5/math.sqrt(2))
                    self.assertAlmostEqual(actual,expected,places=9)
                self.assertEqual(handle.Get('fit_explorer/poisson_low').GetNbinsX(),5)
                fitted=handle.Get('fit_explorer/parameters').FindObject('N_SS')
                self.assertAlmostEqual(fitted.FindObject('error').GetVal(),.5)

            with self.assertRaises(FileExistsError):scope['save_fit_root'](path,**args)
            variable=args['components']['SS'][1];variable.setVal(3.)
            with self.assertRaises(ValueError):scope['save_fit_root'](Path(directory)/'mismatch.root',**args)


    def test_reject_integer_weighted_histogram_sumw2(self):
        args=self.fixture();x,y=[a[0]for a in args['axes']]
        hist=R.TH2D('weighted_hist','Integer weights with non-Poisson variance',2,-5.,5.,2,-5.,5.);hist.SetDirectory(0);hist.Sumw2()
        for i in (1,2):
            for j in (1,2):hist.SetBinContent(i,j,2.);hist.SetBinError(i,j,2.)
        data=R.RooDataHist('weighted_data','Storage test only',R.RooArgList(x,y),hist)
        self.keep.extend([hist,data]);self.assertFalse(data.isNonPoissonWeighted())
        args['data']=data
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError,'SumW2'):save_fit_root(Path(directory)/'bad.root',**args)

    def test_observed_internal_edges_are_half_open(self):
        args=self.fixture();x,y=[a[0]for a in args['axes']]
        x.setRange(3.6,3.74);data=R.RooDataSet('edge_data','Deterministic edge test',R.RooArgSet(x,y));y.setVal(0.)
        for i in range(41):x.setVal(3.6+(3.74-3.6)*i/40);data.add(R.RooArgSet(x,y))
        self.keep.append(data);args.update(data=data,bins=40,sample_points=3)
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'edges.root';save_fit_root(path,**args)
            with R.TFile.Open(str(path)) as handle:
                hist=handle.Get('fit_explorer/observed');self.assertEqual(hist.Integral(),41)
                for i in range(40):self.assertEqual(sum(hist.GetBinContent(i+1,j+1)for j in range(40)),2 if i==39 else 1)


    def arbitrary_fixture(self, recursive=False, wrapped=False):
        x=R.RooRealVar('mass_a','mass_a',-5.,5.);y=R.RooRealVar('mass_b','mass_b',-5.,5.)
        sigma=R.RooRealVar('spread','spread',1.,.1,3.);sigma.setConstant(True)
        means=[R.RooRealVar('location_'+str(i),'location',value)for i,value in enumerate((-1.,0.,1.,.5,2.,-1.))]
        for mean in means:mean.setConstant(True)
        pdfs=[];keep=[x,y,sigma,*means]
        for i,name in enumerate(('left head','constructor','third_head') if recursive else ('left head','constructor')):
            a=R.RooGaussian('axis_a_'+str(i),'a',x,means[2*i],sigma);b=R.RooGaussian('axis_b_'+str(i),'b',y,means[2*i+1],sigma)
            head=R.RooProdPdf(name,'Gaussian head '+str(i+1),R.RooArgList(a,b));pdfs.append(head);keep.extend([a,b,head])
        fraction=R.RooRealVar('head_fraction','head fraction',.3,0.,1.);fraction.setError(.1)
        second=R.RooRealVar('second_fraction','second fraction',.2,0.,1.);second.setError(.05)
        fractions=[fraction,second] if recursive else [fraction]
        peak=R.RooAddPdf('twin_peak','Two-headed peak',R.RooArgList(*pdfs),R.RooArgList(*fractions),recursive)
        slope=R.RooRealVar('power','power',-1.);slope.setConstant(True)
        a=R.RooGenericPdf('power_a','pow(@0+6.,@1)',R.RooArgList(x,slope));b=R.RooGenericPdf('power_b','pow(@0+6.,@1)',R.RooArgList(y,slope));background=R.RooProdPdf('power_background','Power background',R.RooArgList(a,b))
        n=R.RooRealVar('N_peak','Peak yield',10.,0.,100.);nb=R.RooRealVar('N_background','Background yield',20.,0.,100.);n.setError(2.);nb.setError(3.)
        if wrapped:
            model=R.RooExtendPdf('extended_model','Extended mixture',peak,n);final=[n,*fractions]
        else:
            model=R.RooAddPdf('arbitrary_model','Arbitrary component names',R.RooArgList(peak,background),R.RooArgList(n,nb));final=[n,nb,*fractions]
        data=R.RooDataSet('data','Deterministic fixture',R.RooArgSet(x,y))
        for av,bv in [(-1.,-1.),(-1.,1.),(1.,-1.),(1.,1.)]:x.setVal(av);y.setVal(bv);data.add(R.RooArgSet(x,y))
        result=R.RooFitResult('result','Serialization test, no fit');result.setFinalParList(R.RooArgList(*final));result.setInitParList(R.RooArgList(*final));result.setConstParList(R.RooArgList(sigma,*means,slope))
        covariance=R.TMatrixDSym(len(final))
        for i,var in enumerate(final):covariance[i][i]=var.getError()**2
        fraction_index=final.index(fraction);covariance[0][fraction_index]=.1;covariance[fraction_index][0]=.1
        result.setCovarianceMatrix(covariance)
        self.keep=keep+[fraction,second,peak,slope,a,b,background,n,nb,model,data,result,covariance]
        return dict(model=model,data=data,result=result,axes=[(x,'Mass a','arb.'),(y,'Mass b','arb.')],bins=2,sample_points=9)

    def test_arbitrary_auto_tree_and_full_covariance(self):
        args=self.arbitrary_fixture()
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'arbitrary.root';save_fit_root(path,**args)
            with R.TFile.Open(str(path)) as handle:
                peak=handle.GetDirectory('fit_explorer/components/twin_peak')
                self.assertTrue(peak);self.assertTrue(handle.GetDirectory('fit_explorer/components/power_background'))
                self.assertEqual(peak.Get('order').GetVal(),0)
                self.assertEqual(peak.Get('pdf_name').GetTitle(),'twin_peak')
                children=peak.GetDirectory('children')
                first=children.GetDirectory('twin_peak__left_head');second=children.GetDirectory('twin_peak__component_constructor')
                self.assertTrue(first);self.assertTrue(second)
                self.assertAlmostEqual(first.Get('yield').GetVal(),3.)
                self.assertAlmostEqual(second.Get('yield').GetVal(),7.)
                self.assertAlmostEqual(first.Get('error').GetVal(),math.sqrt(1.96),places=8)
                self.assertAlmostEqual(second.Get('error').GetVal(),math.sqrt(1.56),places=8)
                for i in (1,2):
                    for j in (1,2):self.assertAlmostEqual(first.Get('expected').GetBinContent(i,j)+second.Get('expected').GetBinContent(i,j),peak.Get('expected').GetBinContent(i,j),delta=1e-6+1e-5*peak.Get('expected').GetBinContent(i,j))
                self.assertFalse(handle.GetDirectory('fit_explorer/components/power_background/children'))

    def test_recursive_effective_fractions_are_not_applied_twice(self):
        args=self.arbitrary_fixture(recursive=True)
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'recursive.root';save_fit_root(path,**args)
            with R.TFile.Open(str(path)) as handle:
                prefix='fit_explorer/components/twin_peak/children/'
                for name,expected in [('twin_peak__left_head',3.),('twin_peak__component_constructor',1.4),('twin_peak__third_head',5.6)]:self.assertAlmostEqual(handle.Get(prefix+name+'/yield').GetVal(),expected)

    def test_rooextend_wrapper_uses_native_expected_events(self):
        args=self.arbitrary_fixture(wrapped=True)
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'wrapped.root';save_fit_root(path,**args)
            with R.TFile.Open(str(path)) as handle:
                self.assertAlmostEqual(handle.Get('fit_explorer/components/left_head/yield').GetVal(),3.)
                self.assertAlmostEqual(handle.Get('fit_explorer/components/component_constructor/yield').GetVal(),7.)

    def test_unextended_top_level_does_not_invent_event_yields(self):
        args=self.arbitrary_fixture();args['model']=next(v for v in self.keep if hasattr(v,'GetName')and v.GetName()=='twin_peak')
        # Remove unused fitted yield parameters from this fixture result to isolate semantics.
        reduced=R.RooFitResult('reduced','Fixture');fraction=next(v for v in self.keep if hasattr(v,'GetName')and v.GetName()=='head_fraction');reduced.setFinalParList(R.RooArgList(fraction));reduced.setConstParList(R.RooArgList());args['result']=reduced
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError,'absolute event yields'):save_fit_root(Path(directory)/'bad.root',**args)


if __name__=='__main__':unittest.main()
