/** @jsx React.DOM */
var React = require("react");
var Q = require("q");
var PromisesMixin = require("../../mixins/Promises");

/**
 * FIXME reimplement the button logic inline and with State
 */

var Button = React.createClass({
  mixins: [ PromisesMixin ],
  propTypes: {
    f: React.PropTypes.func.isRequired,
    disabled: React.PropTypes.bool,
    activeCls: React.PropTypes.string,
    debounceRate: React.PropTypes.number
  },
  getDefaultProps: function() {
    return {
      f: function () { throw new Error("f is not implemented"); },
      disabled: false,
      activeCls: "active",
      debounceRate: 200
    };
  },
  isValidClickEvent: function (e) {
    // left click only and no control key pressed
    return e.button === 0 && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey;
  },
  isActive: function () {
    return this.state.job.isPending();
  },
  getInitialState: function () {
    return {
      job: Q()
    };
  },
  onClick: function (e) {
    if (this.isValidClickEvent(e)) {
      e.preventDefault();
      if (!this.isActive() && !this.props.disabled) {
        var job = Q.fcall(this.props.f, e).delay(this.props.debounceRate);
        this.setState({
          job: job
        });
        this.watchQ(job).done();
      }
    }
  },
  render: function () {
    var cls = ["button"];
    if (this.props.disabled) cls.push("disabled");
    if (this.isActive()) cls.push(this.props.activeCls);
    return this.transferPropsTo(
      <a onClick={this.onClick} className={cls.join(" ")} href="">{this.props.children}</a>
    );
  }
});

module.exports = Button;

