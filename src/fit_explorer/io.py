"""Single-file, native ROOT storage for Fit Explorer.

The browser reads only fit_explorer/* objects, never executes RooFit/custom code.
All arrays are ROOT histograms/graphs; no serialized text data payload is used.
Saving/evaluation never invokes fitting, minimization, or event generation.
"""
from array import array
from bisect import bisect_right
import inspect
import hashlib
import re
import math
from pathlib import Path


def _root():
    import ROOT
    return ROOT


def _named(root, directory, name, value):
    directory.WriteObject(root.TNamed(name, str(value)), name)


def _scalar(root, directory, name, value, integer=False):
    item = root.TParameter("int" if integer else "double")(name, int(value) if integer else float(value))
    directory.WriteObject(item, name)


def _hist2(root, directory, name, xedges, yedges, values):
    nx, ny = len(xedges)-1, len(yedges)-1
    if len(values) != nx*ny:
        raise ValueError("Incorrect 2D dimensions for " + name)
    hist = root.TH2D(name, name, nx, array("d", xedges), ny, array("d", yedges))
    hist.SetDirectory(0)
    for ix in range(nx):
        for iy in range(ny):
            value = float(values[ix*ny+iy])
            if not math.isfinite(value) or value < 0:
                raise ValueError("Invalid count/intensity in " + name)
            hist.SetBinContent(ix+1, iy+1, value)
    directory.WriteObject(hist, name)


def _hist1(root, directory, name, values):
    hist = root.TH1D(name, name, len(values), -.5, len(values)-.5)
    hist.SetDirectory(0)
    for i, value in enumerate(values):
        hist.SetBinContent(i+1, float(value))
    directory.WriteObject(hist, name)


def _parameters(root, directory, parameters):
    rows = root.TList(); rows.SetName("parameters"); rows.SetOwner(True)
    for p in parameters:
        row = root.TList(); row.SetName(str(p["name"])); row.SetOwner(True)
        for key in ("name", "label", "unit"):
            obj = root.TNamed(key, str(p.get(key, p["name"] if key == "label" else "")))
            row.Add(obj); root.SetOwnership(obj, False)
        for key in ("value", "error"):
            if p.get(key) is not None:
                obj = root.TParameter("double")(key, float(p[key]))
                row.Add(obj); root.SetOwnership(obj, False)
        obj = root.TParameter("int")("fixed", int(bool(p.get("fixed", False))))
        row.Add(obj); root.SetOwnership(obj, False)
        rows.Add(row); root.SetOwnership(row, False)
    directory.WriteObject(rows, "parameters")


def _write_component(root, parent, component, xedges, yedges):
    target = parent.mkdir(component["id"])
    _named(root, target, "label", component.get("label", component["id"]))
    _named(root, target, "description", component.get("description", ""))
    for key in ("pdf_name", "class_name", "yield_name", "color"):
        if component.get(key) is not None:
            _named(root, target, key, component[key])
    if component.get("order") is not None:
        _scalar(root, target, "order", component["order"], integer=True)
    _hist2(root, target, "expected", xedges, yedges, component["expected"])
    _scalar(root, target, "yield", component["yield"]["value"])
    _scalar(root, target, "error", component["yield"]["error"])
    _parameters(root, target, component.get("parameters", []))
    if component.get("children"):
        children = target.mkdir("children")
        for child in component["children"]:
            _write_component(root, children, child, xedges, yedges)


def _write_display(root, output, package):
    target = output.mkdir("fit_explorer")
    _named(root, target, "format", "fit-explorer.root/1")
    for key in ("title", "channel"):
        _named(root, target, key, package.get(key, ""))
    _named(root, target, "baseline_id", package.get("provenance", {}).get("baseline_id", ""))
    axes = package["axes"]
    xedges, yedges = axes[0]["edges"], axes[1]["edges"]
    for prefix, axis in zip(("x", "y"), axes):
        for key in ("name", "label", "unit"):
            _named(root, target, prefix+"_"+key, axis.get(key, ""))
    _hist2(root, target, "observed", xedges, yedges, package["observed"])
    for key in ("low", "high"):
        _hist1(root, target, "poisson_"+key, package["poisson_lookup"][key])
    maximum = package.get("display", {}).get("z_max")
    if maximum is None:
        totals = [sum(c["expected"][i] for c in package["components"]) for i in range(len(package["observed"]))]
        maximum = 1.12*max(1, *package["observed"], *totals)
    _scalar(root, target, "z_max", maximum)
    components = target.mkdir("components")
    for component in package["components"]:
        _write_component(root, components, component, xedges, yedges)
    _parameters(root, target, package.get("parameters", []))
    sampling = package.get("projection_samples")
    if sampling:
        projections = target.mkdir("projections")
        for k, axis in enumerate(sampling["axes"]):
            destination = projections.mkdir("axis"+str(k)); points = axis["points"]
            graph = root.TGraph(len(points), array("d", points), array("d", [0.]*len(points)))
            graph.SetName("points"); destination.WriteObject(graph, "points")
            _scalar(root, destination, "bin_width", axis.get("bin_width", (axes[k]["edges"][-1]-axes[k]["edges"][0])/package["shape"][k]))
            destination = destination.mkdir("components")
            for key, values in axis["components"].items():
                _hist2(root, destination, key, list(range(len(points)+1)), axes[1-k]["edges"], values)
    return target


def write_root_package(path, package, *, workspace=None, fit_result=None, root=None):
    """Write exact existing display arrays and optional native fit, without refitting.

    package is an internal Python mapping. Output contains only native ROOT objects.
    workspace/fit_result may be live PyROOT objects from a saved accepted fit.
    """
    root = root or _root(); path = Path(path)
    if path.exists():
        raise FileExistsError(path)
    if not path.parent.is_dir():
        raise FileNotFoundError(path.parent)
    output = root.TFile.Open(str(path), "CREATE")
    if not output or output.IsZombie():
        raise OSError(path)
    try:
        output.SetCompressionSettings(101)  # ZLIB: portable offline browser reading.
        if workspace is not None:
            output.WriteObject(workspace, "workspace")
        if fit_result is not None:
            output.WriteObject(fit_result, "fit_result")
        _write_display(root, output, package)
        output.Write()
        if output.TestBit(root.TFile.kWriteError):
            raise OSError("Failed writing ROOT file")
    finally:
        output.Close()
    return path


def make_example_root(path):
    """Create a clearly synthetic, deterministic format example; no fitting."""
    root = _root()
    expected = {"SS": [2., .2, .1, 1.7], "SB": [.5]*4, "BS": [.5]*4, "BB": [.5]*4}
    low, high = _poisson_lookup(root, 10)
    package = {"title": "Format example · synthetic", "channel": "demo", "shape": [2, 2],
               "axes": [{"name": "observable_1", "label": "Observable 1", "unit": "arb.", "edges": [0., .5, 1.]},
                        {"name": "observable_2", "label": "Observable 2", "unit": "arb.", "edges": [0., .5, 1.]}],
               "observed": [4, 1, 2, 3], "poisson_lookup": {"low": low, "high": high},
               "components": [{"id": key, "label": key, "expected": values,
                               "yield": {"value": sum(values), "error": 0.}, "parameters": []}
                              for key, values in expected.items()], "parameters": [], "display": {"z_max": 4.48}}
    x = root.RooRealVar("observable_1", "Observable 1", 0., 1.)
    y = root.RooRealVar("observable_2", "Observable 2", 0., 1.)
    x.setBins(2); y.setBins(2)
    keep, pdfs, yields = [x, y], root.RooArgList(), root.RooArgList()
    for key, values in expected.items():
        hist = root.TH2D("template_"+key, "Synthetic template", 2, 0., 1., 2, 0., 1.); hist.SetDirectory(0)
        for i in range(2):
            for j in range(2):
                hist.SetBinContent(i+1, j+1, values[i*2+j])
        binned = root.RooDataHist("template_data_"+key, "Synthetic template", root.RooArgList(x, y), hist)
        pdf = root.RooHistPdf(key, "Synthetic "+key, root.RooArgSet(x, y), binned)
        amount = root.RooRealVar("N_"+key, "Illustrative expected count", sum(values)); amount.setConstant(True)
        pdfs.add(pdf); yields.add(amount); keep.extend([hist, binned, pdf, amount])
    model = root.RooAddPdf("model", "Synthetic format example, no fit executed", pdfs, yields)
    hist = root.TH2D("example_observed", "Synthetic illustrative counts", 2, 0., 1., 2, 0., 1.); hist.SetDirectory(0)
    for i in range(2):
        for j in range(2):
            hist.SetBinContent(i+1, j+1, package["observed"][i*2+j])
    data = root.RooDataHist("data", "Synthetic illustrative counts, not a measurement", root.RooArgList(x, y), hist)
    workspace = root.RooWorkspace("workspace")
    getattr(workspace, "import")(model); getattr(workspace, "import")(data)
    assert workspace.saveSnapshot("best_fit", workspace.pdf("model").getParameters(workspace.data("data")))
    return write_root_package(path, package, workspace=workspace, root=root)


def _poisson_lookup(root, total):
    alpha = 1.-.682689492137
    low, high = [], []
    for count in range(total+1):
        lower = root.Math.gamma_quantile(alpha/2., count, 1.) if count else 0.
        upper = root.Math.gamma_quantile_c(alpha/2., count+1, 1.)
        low.append(float(count-lower)); high.append(float(upper-count))
    return low, high


def _parameter_rows(parameters, result=None):
    rows = []
    for variable in parameters:
        if not hasattr(variable, "getVal"):
            continue
        fixed = bool(variable.isConstant())
        fitted = result.floatParsFinal().find(variable.GetName()) if result is not None else None
        error = 0. if fixed else float(fitted.getError()) if fitted else float(variable.getError()) if hasattr(variable, "getError") else 0.
        rows.append({"name": variable.GetName(), "label": variable.GetTitle() or variable.GetName(),
                     "unit": variable.getUnit() if hasattr(variable, "getUnit") else "",
                     "value": float(variable.getVal()), "error": error, "fixed": fixed})
    return rows


def _uniform_edges(lo, hi, count):
    if not isinstance(count, int) or not 2 <= count <= 160 or not math.isfinite(lo+hi) or hi <= lo:
        raise ValueError("Use 2..160 bins and finite increasing axis bounds")
    return [lo+(hi-lo)*i/count for i in range(count+1)]


def _check_saved_state(workspace, result):
    for value in result.floatParsFinal():
        saved = workspace.var(value.GetName())
        if not saved or saved.isConstant() or not math.isclose(saved.getVal(), value.getVal(), rel_tol=1e-10, abs_tol=1e-12):
            raise ValueError("Model is not at saved best fit: " + value.GetName())
    for value in result.constPars():
        saved = workspace.arg(value.GetName())
        if saved and (not saved.isConstant() or not math.isclose(saved.getVal(), value.getVal(), rel_tol=1e-10, abs_tol=1e-12)):
            raise ValueError("Fixed parameter changed after fitting: " + value.GetName())


def _safe_component_id(name, scope, used):
    raw = str(name)
    token = re.sub(r"[^A-Za-z0-9_]", "_", raw) or "component"
    if token[0].isdigit() or token in {"all", "total", "__proto__", "constructor", "prototype"}:
        token = "component_"+token
    candidate = (scope+"__" if scope else "")+token
    if len(candidate) > 160:
        candidate = candidate[:145]+"__"+hashlib.sha1(candidate.encode()).hexdigest()[:10]
    base, suffix = candidate, 2
    while candidate in used:
        candidate = base+"_"+str(suffix); suffix += 1
    used.add(candidate)
    return candidate


def _store_formula(root, workspace, name, expression, args):
    base, suffix = name, 2
    while workspace.arg(name):
        name = base+"_"+str(suffix); suffix += 1
    formula = root.RooFormulaVar(name, expression, root.RooArgList(*args))
    if getattr(workspace, "import")(formula, root.RooFit.RecycleConflictNodes()):
        raise RuntimeError("Could not store derived yield " + name)
    return workspace.arg(name)


def _expected_events_function(root, workspace, pdf, norm, name):
    try:
        function = pdf.createExpectedEventsFunc(norm)
    except Exception as error:
        raise ValueError("Cannot derive expected events for "+pdf.GetName()+"; provide explicit absolute yields") from error
    if not function:
        raise ValueError("Missing expected-events function for " + pdf.GetName())
    base, suffix = name, 2
    while workspace.arg(name):
        name = base+"_"+str(suffix); suffix += 1
    function.SetName(name)
    if getattr(workspace, "import")(function, root.RooFit.RecycleConflictNodes()):
        raise RuntimeError("Cannot store expected-events function")
    return workspace.arg(name)


def _check_additive_reference(pdf, norm):
    reference = pdf.getCoefNormalization()
    if reference.getSize() and {v.GetName() for v in reference} != {v.GetName() for v in norm}:
        raise ValueError("Automatic discovery does not support conditional coefficient normalization: " + pdf.GetName())
    reference_range = str(pdf.getCoefRange() or "")
    if reference_range:
        for variable in norm:
            if (not variable.hasRange(reference_range) or
                    not math.isclose(variable.getMin(reference_range), variable.getMin(), rel_tol=1e-12, abs_tol=1e-12) or
                    not math.isclose(variable.getMax(reference_range), variable.getMax(), rel_tol=1e-12, abs_tol=1e-12)):
                raise ValueError("Coefficient reference range differs from default domain: " + pdf.GetName())


def _discover_components(root, workspace, model, norm, *, explicit=None, norm_range=None):
    # ROOT stores recursive RooAddPdf weights as RooRecursiveFraction coefficients.
    # coefList() already contains their effective products; never recurse them twice.
    used, flat = set(), []
    restricted_domain = False
    if norm_range:
        restricted_domain = any(not math.isclose(variable.getMin(norm_range), variable.getMin(), rel_tol=1e-12, abs_tol=1e-12) or
                                not math.isclose(variable.getMax(norm_range), variable.getMax(), rel_tol=1e-12, abs_tol=1e-12) for variable in norm)
    if explicit is None and restricted_domain:
        raise ValueError("Automatic discovery needs default full ranges; provide explicit absolute component yields for a restricted domain")

    def additive_parts(pdf):
        if restricted_domain:
            raise ValueError("Automatic nested decomposition of restricted domains needs another adapter")
        _check_additive_reference(pdf, norm)
        parts, coefficients = list(pdf.pdfList()), list(pdf.coefList())
        if not parts:
            raise ValueError("Empty additive model")
        if any(coefficient.dependsOn(norm) for coefficient in coefficients):
            raise ValueError("Observable-dependent mixture coefficients need another adapter")
        if not coefficients:
            if not all(part.canBeExtended() for part in parts):
                raise ValueError("Additive model has no usable yields")
            coefficients = [_expected_events_function(root, workspace, part, norm,
                            "fit_explorer_expected_"+str(len(flat))+"_"+str(i)) for i, part in enumerate(parts)]
            return parts, coefficients, True
        if len(coefficients) == len(parts)-1:
            remaining = _store_formula(root, workspace, "fit_explorer_last_fraction_"+str(len(flat)),
                                       "1-("+"+".join("@"+str(i) for i in range(len(coefficients)))+")", coefficients)
            return parts, coefficients+[remaining], False
        if len(coefficients) != len(parts):
            raise ValueError("Unsupported additive coefficient layout")
        return parts, coefficients, bool(pdf.canBeExtended())

    def wrapper_pdf(pdf):
        wrapped = [server for server in pdf.servers() if server.InheritsFrom("RooAbsPdf")]
        if len(wrapped) != 1:
            raise ValueError("Cannot identify the wrapped PDF in " + pdf.GetName())
        return wrapped[0]

    def attach(pdf, amount, scope, depth, order, preferred=None):
        if depth > 8 or len(flat) >= 512:
            raise ValueError("Component tree exceeds the supported depth/size")
        identifier = _safe_component_id(preferred if preferred is not None else pdf.GetName(), scope, used)
        row = {"id": identifier, "label": pdf.GetTitle() or pdf.GetName(),
               "description": pdf.ClassName(), "pdf_name": pdf.GetName(), "class_name": pdf.ClassName(),
               "yield_name": amount.GetName(), "order": order, "expected": []}
        item = {"row": row, "pdf": pdf, "amount": amount}; flat.append(item)
        branch = wrapper_pdf(pdf) if pdf.InheritsFrom("RooExtendPdf") else pdf
        if branch.InheritsFrom("RooAddPdf"):
            parts, coefficients, extended = additive_parts(branch)
            values = [float(coefficient.getVal()) for coefficient in coefficients]
            if any(not math.isfinite(value) or value < -1e-12 for value in values):
                raise ValueError("Negative/nonfinite additive coefficient")
            if extended:
                if sum(values) <= 0:
                    raise ValueError("Nonpositive nested extended yield sum")
            elif not math.isclose(sum(values), 1., rel_tol=1e-10, abs_tol=1e-10):
                raise ValueError("Effective mixture fractions do not sum to one")
            children = []
            for i, (part, coefficient) in enumerate(zip(parts, coefficients)):
                if extended:
                    args = [amount, coefficient, *coefficients]
                    expression = "@0*@1/("+"+".join("@"+str(k+2) for k in range(len(coefficients)))+")"
                else:
                    args, expression = [amount, coefficient], "@0*@1"
                child_amount = _store_formula(root, workspace, "fit_explorer_yield_"+identifier+"_"+str(i), expression, args)
                children.append(attach(part, child_amount, identifier, depth+1, i))
            row["children"] = children
        return row

    if explicit is not None:
        if not explicit:
            raise ValueError("Explicit components mapping cannot be empty")
        roots = []
        for i, (key, pair) in enumerate(explicit.items()):
            component, amount = pair
            native, coefficient = workspace.pdf(component.GetName()), workspace.arg(amount.GetName())
            if not native or not coefficient:
                raise ValueError("Explicit component PDFs and yields must belong to the model")
            roots.append(attach(native, coefficient, "", 0, i, preferred=key))
    elif model.InheritsFrom("RooAddPdf"):
        parts, coefficients, extended = additive_parts(model)
        if not extended:
            raise ValueError("Top-level mixture has no absolute event yields; use an extended model or explicit component yields")
        roots = [attach(part, coefficient, "", 0, i) for i, (part, coefficient) in enumerate(zip(parts, coefficients))]
    elif model.canBeExtended():
        amount = _expected_events_function(root, workspace, model, norm, "fit_explorer_expected_model")
        branch = wrapper_pdf(model) if model.InheritsFrom("RooExtendPdf") else model
        if branch.InheritsFrom("RooAddPdf"):
            parts, coefficients, extended = additive_parts(branch)
            roots = []
            for i, (part, coefficient) in enumerate(zip(parts, coefficients)):
                expression, args = "@0*@1", [amount, coefficient]
                if extended:
                    expression = "@0*@1/("+"+".join("@"+str(k+2) for k in range(len(coefficients)))+")"
                    args += coefficients
                child_amount = _store_formula(root, workspace, "fit_explorer_yield_root_"+str(i), expression, args)
                roots.append(attach(part, child_amount, "", 0, i))
        else:
            roots = [attach(branch, amount, "", 0, 0)]
    else:
        raise ValueError("Automatic discovery requires an extended RooAddPdf or RooExtendPdf; provide explicit absolute component yields")
    return roots, flat


def _check_component_closure(roots, arrays=None):
    def visit(row):
        children = row.get("children", [])
        if not children:
            return
        for child in children:
            visit(child)
        keys = arrays[row["id"]] if arrays is not None else row["expected"]
        for i, value in enumerate(keys):
            total = sum((arrays[child["id"]] if arrays is not None else child["expected"])[i] for child in children)
            if abs(total-value) > 1e-6+1e-5*abs(value):
                raise ValueError("Nested components do not reproduce parent "+row["id"]+" at index "+str(i)+": "+str(total)+" vs "+str(value))
    for row in roots:
        visit(row)


def save_fit_root(path, *, model, data, result, axes, components=None, norm_range=None,
                  custom_pdf_classes=(), bins=40, sample_points=401, title="Saved 2D fit", channel="fit"):
    """Save one directly loadable ROOT file after an existing 2D RooFit fit.

    axes: [(RooRealVar, label, unit), (RooRealVar, label, unit)].
    components=None discovers the extended additive PDF tree automatically.
    Optional explicit mapping: {"my_component": (component_pdf, absolute_yield)}.
    Each yield is an absolute expected count in the declared normalization domain.
    norm_range: one named rectangular domain, or None for default observable ranges.
    Unit-weight RooDataSet and uniform-bin Poisson RooDataHist are supported.
    Native display integrals are evaluated once; this never calls fitTo/minimization.
    """
    root = _root(); path = Path(path)
    if path.exists():
        raise FileExistsError(path)
    if result is None or len(axes) != 2 or len({v.GetName() for v, _, _ in axes}) != 2:
        raise ValueError("Provide RooFitResult and two distinct observables")
    if norm_range and "," in norm_range:
        raise ValueError("Only one rectangular normalization range is supported")
    if not isinstance(sample_points, int) or not 3 <= sample_points <= 2001:
        raise ValueError("Use 3..2001 projection sample points")
    if data.InheritsFrom("RooDataSet") and data.isWeighted():
        raise ValueError("Weighted data require a weighted-error adapter")
    if data.InheritsFrom("RooDataHist") and data.isNonPoissonWeighted():
        raise ValueError("Non-Poisson binned errors require an appropriate adapter")
    workspace = root.RooWorkspace("workspace")
    getattr(workspace, "import")(model); getattr(workspace, "import")(data)
    pdf, dataset = workspace.pdf(model.GetName()), workspace.data(data.GetName())
    if not pdf or not dataset:
        raise ValueError("Model/data import failed")
    _check_saved_state(workspace, result)
    variables, edges, axis_rows = [], [], []
    for variable, label, unit in axes:
        saved = workspace.var(variable.GetName())
        if not saved or not dataset.get().find(variable.GetName()):
            raise ValueError("Observable must belong to model and dataset")
        if norm_range and not saved.hasRange(norm_range):
            raise ValueError("Named normalization range is missing")
        lo, hi = (saved.getMin(norm_range), saved.getMax(norm_range)) if norm_range else (saved.getMin(), saved.getMax())
        count = bins
        if data.InheritsFrom("RooDataHist"):
            native = dataset.get().find(variable.GetName()).getBinning()
            native_edges = [native.binLow(0)]+[native.binHigh(i) for i in range(native.numBins())]
            native_step = native_edges[1]-native_edges[0]
            if (not math.isclose(lo, native_edges[0], rel_tol=1e-12, abs_tol=1e-12) or
                    not math.isclose(hi, native_edges[-1], rel_tol=1e-12, abs_tol=1e-12) or
                    any(not math.isclose(b-a, native_step, rel_tol=1e-10, abs_tol=1e-12) for a, b in zip(native_edges, native_edges[1:]))):
                raise ValueError("Binned data need uniform bins matching the normalization domain")
            count = native.numBins()
        axis_edges = _uniform_edges(float(lo), float(hi), count)
        saved.setRange("fit_explorer_domain", float(lo), float(hi))
        variables.append(saved); edges.append(axis_edges)
        axis_rows.append({"name": saved.GetName(), "label": label, "unit": unit, "edges": axis_edges})
    norm = root.RooArgSet(*variables)
    nx, ny = len(edges[0])-1, len(edges[1])-1
    observed = [0]*(nx*ny)
    for entry in range(dataset.numEntries()):
        row = dataset.get(entry); values = [row.getRealValue(v.GetName()) for v in variables]
        if any(not math.isfinite(v) or v < e[0] or v > e[-1] for v, e in zip(values, edges)):
            continue  # Raw data remain complete in workspace; display uses declared fit domain.
        weight = float(dataset.weight())
        if weight < 0 or not math.isclose(weight, round(weight), abs_tol=1e-10):
            raise ValueError("Noninteger/negative observed weights require another adapter")
        if data.InheritsFrom("RooDataHist"):
            variance = float(dataset.weightError(root.RooAbsData.SumW2))**2
            if not math.isclose(variance, weight, rel_tol=1e-8, abs_tol=1e-10):
                raise ValueError("Non-Poisson binned SumW2 errors require another adapter")
        indices = [min(len(e)-2, bisect_right(e, v)-1) for v, e in zip(values, edges)]
        observed[indices[0]*ny+indices[1]] += int(round(weight))
    low, high = _poisson_lookup(root, sum(observed))
    roots, discovered = _discover_components(root, workspace, pdf, norm, explicit=components, norm_range=norm_range)
    nodes, denominators, amounts, rows = {}, {}, {}, []
    for item in discovered:
        row, native, coefficient = item["row"], item["pdf"], item["amount"]
        key = row["id"]
        value = float(coefficient.getVal())
        error = 0. if coefficient.isConstant() else float(coefficient.getPropagatedError(result))
        if not math.isfinite(value+error) or value < 0 or error < 0:
            raise ValueError("Invalid fitted component yield")
        integral = native.createIntegral(norm, root.RooFit.NormSet(norm), root.RooFit.Range("fit_explorer_domain"))
        denominator = float(integral.getVal())
        if not math.isfinite(denominator) or denominator <= 0:
            raise ValueError("Nonpositive component normalization")
        nodes[key], denominators[key], amounts[key] = native, denominator, value
        params = root.RooArgSet(native.getParameters(dataset)); params.add(coefficient.getParameters(norm), True)
        row.update({"yield": {"value": value, "error": error}, "parameters": _parameter_rows(params, result)})
        rows.append(row)
    for ix in range(nx):
        variables[0].setRange("fit_explorer_cell", edges[0][ix], edges[0][ix+1])
        for iy in range(ny):
            variables[1].setRange("fit_explorer_cell", edges[1][iy], edges[1][iy+1])
            for row in rows:
                key = row["id"]
                integral = nodes[key].createIntegral(norm, root.RooFit.NormSet(norm), root.RooFit.Range("fit_explorer_cell"))
                value = float(integral.getVal())*amounts[key]/denominators[key]
                if not math.isfinite(value) or value < -1e-10:
                    raise ValueError("Invalid integrated component count")
                row["expected"].append(max(0., value))
    for row in rows:
        if abs(sum(row["expected"])-row["yield"]["value"]) > 1e-6+1e-5*row["yield"]["value"]:
            raise ValueError("Native bin integrals do not sum to fitted yield: " + row["id"])
    _check_component_closure(roots)
    sampling = []
    for axis in range(2):
        own, other = variables[axis], variables[1-axis]; own_edges, other_edges = edges[axis], edges[1-axis]
        points = [own_edges[0]+(own_edges[-1]-own_edges[0])*i/(sample_points-1) for i in range(sample_points)]
        width = (own_edges[-1]-own_edges[0])/(len(own_edges)-1)
        arrays = {key: [0.]*(sample_points*(len(other_edges)-1)) for key in nodes}
        for j in range(len(other_edges)-1):
            name = "fit_explorer_projection_"+str(axis)+"_"+str(j)
            other.setRange(name, other_edges[j], other_edges[j+1])
            integrals = {key: native.createIntegral(root.RooArgSet(other), root.RooFit.NormSet(norm), root.RooFit.Range(name)) for key, native in nodes.items()}
            for i, point in enumerate(points):
                own.setVal(point)
                for key, integral in integrals.items():
                    value = float(integral.getVal())*amounts[key]/denominators[key]*width
                    if not math.isfinite(value) or value < -1e-10:
                        raise ValueError("Invalid projection intensity")
                    arrays[key][i*(len(other_edges)-1)+j] = max(0., value)
        _check_component_closure(roots, arrays)
        sampling.append({"points": points, "other_bins": len(other_edges)-1, "bin_width": width, "components": arrays})
    parameters = _parameter_rows(pdf.getParameters(dataset), result)
    if not workspace.saveSnapshot("best_fit", pdf.getParameters(dataset)):
        raise RuntimeError("Could not save best_fit snapshot")
    for name in custom_pdf_classes:
        if not workspace.importClassCode(name, True):
            raise RuntimeError("Cannot embed custom PDF code: " + name)
    package = {"title": title, "channel": channel, "axes": axis_rows, "shape": [nx, ny], "observed": observed,
               "poisson_lookup": {"low": low, "high": high}, "components": roots, "parameters": parameters,
               "projection_samples": {"version": 1, "axes": sampling}}
    write_root_package(path, package, workspace=workspace, fit_result=result, root=root)
    # Native bookkeeping accompanies native workspace; no external manifest is required.
    output = root.TFile.Open(str(path), "UPDATE")
    try:
        target = output.GetDirectory("fit_explorer")
        for key, value in (("model_name", model.GetName()), ("data_name", data.GetName()),
                           ("normalization_range", norm_range or "default"), ("ROOT_version", root.gROOT.GetVersion())):
            _named(root, target, key, value)
        _scalar(root, target, "eps_abs", root.RooAbsReal.defaultIntegratorConfig().epsAbs())
        _scalar(root, target, "eps_rel", root.RooAbsReal.defaultIntegratorConfig().epsRel())
    finally:
        output.Close()
    return path


def standalone_saving_code():
    """Exact self-contained Python copied by Data Guide."""
    names = (_root, _named, _scalar, _hist2, _hist1, _parameters, _write_component,
             _write_display, write_root_package, _poisson_lookup, _parameter_rows,
             _uniform_edges, _check_saved_state, _safe_component_id, _store_formula,
             _expected_events_function, _check_additive_reference, _discover_components,
             _check_component_closure, save_fit_root)
    return "from array import array\nfrom bisect import bisect_right\nimport math\nimport hashlib\nimport re\nfrom pathlib import Path\n\n\n"+"\n\n".join(inspect.getsource(item).rstrip() for item in names)+"\n"
