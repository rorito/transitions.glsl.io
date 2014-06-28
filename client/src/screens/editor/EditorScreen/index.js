/** @jsx React.DOM */
var React = require("react");
var _ = require("lodash");
var Q = require("q");
var store = require("store");
var GlslTransitionValidator = require("glsl-transition-validator");
var validator = require("../../../glslio/validator");

var validateTransition = require("../../../glslio/validateTransition");
var BezierEasing = require("bezier-easing");
var Fps = require("../Fps");
var GlslContextualHelp = require("../GlslContextualHelp");
var VignetteConfig = require("../VignetteConfig");
var LicenseLabel = require("../LicenseLabel");
var TransitionPreview = require("../TransitionPreview");
var ValidationIndicator = require("../ValidationIndicator");
var TransitionInfos = require("../TransitionInfos");
var TransitionActions = require("../TransitionActions");
var TransitionComments = require("../TransitionComments");
var TransitionEditor = require("../TransitionEditor");
var UniformsEditor = require("../UniformsEditor");
var Toolbar = require("../../../ui/Toolbar");
var Button = require("../../../ui/Button");
var PromisesMixin = require("../../../mixins/Promises");
var uniformValuesForUniforms = require("../UniformsEditor/uniformValuesForUniforms");

var router = require("../../../core/router");
var model = require("../../../model");
var textures = require("../../../images/textures");

var ignoredUniforms = ["progress", "resolution", "from", "to"];

var unsupportedTypes = ["samplerCube"];

function keepCustomUniforms (uniforms) {
  return _.omit(uniforms, function (uniformType, uniformName) {
    return _.contains(ignoredUniforms, uniformName) || _.contains(unsupportedTypes, uniformType);
  });
}

function onLeavingAppIfUnsaved () {
  return "Are you sure you want to leave this page?\n\nUNSAVED CHANGES WILL BE LOST.";
}

function throwAgain (f, ctx) {
  return function (e) {
    return Q.fcall(_.bind(f, ctx||this, arguments)).thenReject(e);
  };
}

var EditorScreen = React.createClass({
  mixins: [ PromisesMixin ],
  propTypes: {
    env: React.PropTypes.object.isRequired,
    initialTransition: React.PropTypes.object.isRequired,
    images: React.PropTypes.array.isRequired,
    previewWidth: React.PropTypes.number.isRequired,
    previewHeight: React.PropTypes.number.isRequired
  },
  tabs: {
    uniforms: {
      title: "Params",
      icon: "fa-tasks",
      render: function () {
        return <UniformsEditor initialUniformValues={this.state.rawTransition.uniforms} uniforms={this.state.uniformTypes} onUniformsChange={this.onUniformsChange} />;
      }
    },
    doc: {
      title: "Help",
      icon: "fa-info",
      render: function () {
        return <GlslContextualHelp token={this.state.token} />;
      }
    },
    config: {
      title: "Config.",
      icon: "fa-cogs",
      render: function () {
        return <VignetteConfig
          transitionDelay={this.state.transitionDelay}
          transitionDuration={this.state.transitionDuration}
          bezierEasing={this.state.bezierEasing}
          onDurationChange={this.onDurationChange}
          onDelayChange={this.onDelayChange}
          onBezierEasingChange={this.onBezierEasingChange}
          onResetConfig={this.onResetConfig}>
          This panel configures the way you see a Transition in the Editor.
          Configuration are persisted in localStorage of your browser.
        </VignetteConfig>;
      }
    }
  },

  getInitialState: function () {
    var validation = validator.forGlsl(this.props.initialTransition.glsl);
    var uniformTypes = validation.compiles() ? validation.uniforms() : {};
    validation.destroy();
    var uniforms = textures.resolver.resolveSync(this.props.initialTransition.uniforms);
    var bezierEasing;
    try {
      bezierEasing = store.get("editor.bezierEasing");
      BezierEasing.apply(null, bezierEasing); // validate
    } catch (e) {
      bezierEasing = [0, 0, 1, 1];
    }
    var transitionDuration = store.get("editor.transitionDuration");
    if (!transitionDuration || isNaN(transitionDuration)) transitionDuration = 1500;
    var transitionDelay = store.get("editor.transitionDelay");
    if (isNaN(transitionDelay)) transitionDelay = 200;

    return {
      width: this.computeWidth(),
      height: this.computeHeight(),
      // FIXME: we should rename rawTransition to transition, and just keep the transformedUniforms
      rawTransition: this.props.initialTransition,
      transition: _.defaults({ uniforms: uniforms }, this.props.initialTransition),
      uniformTypes: keepCustomUniforms(uniformTypes),
      saveStatusMessage: null,
      saveStatus: null,
      token: null,
      tab: _.size(_.keys(uniforms))>0 ? "uniforms" : "doc",
      fps: null,
      bezierEasing: bezierEasing,
      transitionDuration: transitionDuration,
      transitionDelay: transitionDelay,
      validationErrors: []
    };
  },
  componentWillMount: function () {
    this.lastSavingTransition = this.lastSavedTransition = this.state.rawTransition;
    this.validator = new GlslTransitionValidator(this.props.images[0], this.props.images[1], 50, 30);
  },
  componentDidMount: function () {
    window.addEventListener("resize", this._onResize=_.bind(this.onResize, this), false);
    this.checkDetailedValidation = _.debounce(_.bind(this._checkDetailedValidation, this), 100);
    this.checkDetailedValidation(this.state.transition);
  },
  componentWillUnmount: function () {
    window.removeEventListener("resize", this._onResize);
    this.lastSavingTransition = this.lastSavedTransition = null;
    window.onbeforeunload = null;
    if (this.validator) {
      this.validator.destroy();
      this.validator = null;
    }
  },
  componentDidUpdate: function () {
    var onbeforeunload = this.hasUnsavingChanges() ? onLeavingAppIfUnsaved : null;
    if (onbeforeunload !== window.onbeforeunload)
      window.onbeforeunload = onbeforeunload;
  },

  _checkDetailedValidation: function (transition) {
    if (!this.isMounted()) return;
    var reasons = validateTransition(this.validator, transition);
    if (!_.isEqual(this.state.validationErrors, reasons)) {
      this.setState({
        validationErrors: reasons
      });
    }
  },

  render: function () {
    var hasUnsavingChanges = this.hasUnsavingChanges();
    var env = this.props.env;
    var transition = this.state.transition;
    var images = this.props.images;
    var previewWidth = this.props.previewWidth;
    var previewHeight = this.props.previewHeight;
    var width = this.state.width;
    var height = this.state.height;
    
    var editorWidth = width - 336;
    var editorHeight = height - 40;
    var isPublished = transition.name !== "TEMPLATE";

    var tab = this.tabs[this.state.tab];
    var tabContent = tab.render.apply(this, arguments);
    var tabs = _.map(this.tabs, function (t, tid) {
      var isCurrent = this.state.tab === tid;
      var f = _.bind(function () {
        return this.setStateQ({ tab: tid });
      }, this);
      var cls = ["tab"];
      if (isCurrent) cls.push("current");
      return <Button key={tid} className={cls.join(" ")} f={f} title={t.title}>
        <i className={ "fa "+t.icon }></i><span> {t.title}</span>
      </Button>;
    }, this);

    return <div className="editor-screen" style={{width:width,height:height}}>
      <Toolbar>
        <LicenseLabel />
        <TransitionActions saveDisabled={!hasUnsavingChanges} onSave={this.onSave} onPublish={this.onPublish} env={env} isPublished={isPublished} transition={transition} saveStatusMessage={this.state.saveStatusMessage} saveStatus={this.state.saveStatus} />
        <TransitionInfos env={env} isPublished={isPublished} transition={transition} />
      </Toolbar>
      <div className="main">
        <div className="view">
          <div className="leftPanel">
            <TransitionComments count={transition.comments} href={transition.html_url} />
            <Fps fps={this.state.fps} />
          </div>
          <TransitionPreview transition={transition} images={images} width={previewWidth} height={previewHeight} onTransitionPerformed={this.onTransitionPerformed} transitionDelay={this.state.transitionDelay} transitionDuration={this.state.transitionDuration} transitionEasing={this.getEasing()}>
            <ValidationIndicator errors={this.state.validationErrors} />
          </TransitionPreview>

          <div className="tabs">{tabs}</div>
          <div className="tabContent">{tabContent}</div>
        </div>

        <TransitionEditor onCursorTokenChange={this.onCursorTokenChange} onChangeSuccess={this.onGlslChangeSuccess} onChangeFailure={this.onGlslChangeFailure} initialGlsl={transition.glsl} onSave={this.onSave} width={editorWidth} height={editorHeight} />
      </div>
    </div>;
  },
  getEasing: function () {
    return BezierEasing.apply(this, this.state.bezierEasing);
  },
  computeWidth: function () {
    return Math.max(600, window.innerWidth);
  },
  computeHeight: function () {
    return Math.max(550, window.innerHeight - 60);
  },
  setStateWithUniforms: function (state) {
    return textures.resolver.resolve(state.transition.uniforms)
      .then(_.bind(function (uniforms) {
        var transition = _.defaults({ uniforms: uniforms }, state.transition);
        return this.setStateQ(_.defaults({ transition: transition, rawTransition: state.transition }, state));
      }, this));
  },
  setSaveStatus: function (status, message) {
    return this.setStateQ({
      saveStatus: status,
      saveStatusMessage: message
    });
  },
  saveTransition: function () {
    var transition = _.cloneDeep(this.state.rawTransition);
    this.lastSavingTransition =  transition;
    return this.setSaveStatus("info", "Saving...")
      .thenResolve(transition)
      .then(_.bind(model.saveTransition, model))
      .then(_.bind(function () {
        this.lastSavedTransition = transition;
      }, this))
      .then(_.bind(this.setSaveStatus, this, "success", "Saved."))
      .fail(throwAgain(function () {
        this.lastSavingTransition = null;
        return this.setSaveStatus("error", "Save failed.");
      }, this));
  },
  createNewTransition: function () {
    var transition = _.cloneDeep(this.state.rawTransition);
    this.lastSavingTransition =  transition;
    return this.setSaveStatus("info", "Creating...")
      .thenResolve(transition)
      .then(_.bind(model.createNewTransition, model))
      .then(_.bind(function (r) {
        transition.id = r.id;
        return model.saveTransition(transition);
      }, this))
      .then(_.bind(function () {
        return this.setStateWithUniforms({ transition: transition });
      }, this))
      .then(_.bind(this.setSaveStatus, this, "success", "Created."))
      .then(function () {
        return router.route("/transition/"+transition.id);
      })
      .fail(throwAgain(function () {
        this.lastSavingTransition = null;
        return this.setSaveStatus("error", "Create failed.");
      }, this));
  },
  onDurationChange: function (duration) {
    store.set("editor.transitionDuration", duration);
    this.setState({
      transitionDuration: duration
    });
  },
  onDelayChange: function (delay) {
    store.set("editor.transitionDelay", delay);
    this.setState({
      transitionDelay: delay
    });
  },
  onBezierEasingChange: function (bezierEasing) {
    store.set("editor.bezierEasing", bezierEasing);
    this.setState({
      bezierEasing: bezierEasing
    });
  },
  onResetConfig: function () {
    store.remove("editor.transitionDuration");
    store.remove("editor.transitionDelay");
    store.remove("editor.bezierEasing");
    var initial = this.getInitialState();
    this.setState({
      transitionDuration: initial.transitionDuration,
      transitionDelay: initial.transitionDelay,
      bezierEasing: initial.bezierEasing
    });
  },
  onResize: function () {
    this.setState({
      width: this.computeWidth(),
      height: this.computeHeight()
    });
  },
  onSave: function () {
    if (this.hasUnsavingChanges()) {
      var isRootGist = this.props.env.rootGist === this.state.transition.id;
      if (isRootGist) {
        return this.createNewTransition();
      }
      else {
        return this.saveTransition();
      }
    }
  },
  onPublish: function () {
    // TODO making a proper UI for that. prompt() is the worse but easy solution
    var name = window.prompt("Please choose a transition name (alphanumeric only):");
    if (name.match(/^[a-zA-Z0-9_ ]+$/)) {
      return this.setStateWithUniforms({
          transition: _.defaults({ name: name }, this.state.rawTransition)
        })
        .then(_.bind(this.saveTransition, this))
        .then(_.bind(router.reload, router));
    }
    else {
      window.alert("Title must be alphanumeric.");
    }
  },  
  onCursorTokenChange: function (token) {
    this.setState({
      token: token
    });
  },
  onGlslChangeFailure: function (glsl) {
    this.checkDetailedValidation(_.defaults({
      glsl: glsl
    }, this.state.transition));
  },
  onGlslChangeSuccess: function (glsl, allUniformTypes) {
    var uniformTypes = keepCustomUniforms(allUniformTypes);
    var transition = _.defaults({
        glsl: glsl,
        uniforms: uniformValuesForUniforms(uniformTypes, this.state.rawTransition.uniforms)
      }, this.state.transition);
    this.checkDetailedValidation(transition);
    this.setStateWithUniforms({
      transition: transition,
      uniformTypes: uniformTypes
    });
  },
  onUniformsChange: function (uniforms) {
    this.setStateWithUniforms({
      transition: _.defaults({ uniforms: uniforms }, this.state.rawTransition)
    });
  },
  onTransitionPerformed: function (stats) {
    var fps = Math.round(1000 * stats.frames / stats.elapsedTime);
    this.setState({
      fps: fps
    });
  },
  hasUnsavingChanges: function () {
    return !_.isEqual(this.lastSavingTransition, this.state.rawTransition);
  },
  hasUnsavedChanges: function () {
    return !_.isEqual(this.lastSavedTransition, this.state.rawTransition);
  }
});

module.exports = EditorScreen;

