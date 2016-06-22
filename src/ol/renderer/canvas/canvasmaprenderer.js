// FIXME offset panning

goog.provide('ol.renderer.canvas.Map');

goog.require('goog.asserts');
goog.require('ol.transform');
goog.require('ol');
goog.require('ol.RendererType');
goog.require('ol.array');
goog.require('ol.css');
goog.require('ol.dom');
goog.require('ol.layer.Image');
goog.require('ol.layer.Layer');
goog.require('ol.layer.Tile');
goog.require('ol.layer.Vector');
goog.require('ol.layer.VectorTile');
goog.require('ol.render.Event');
goog.require('ol.render.EventType');
goog.require('ol.render.canvas');
goog.require('ol.render.canvas.Immediate');
goog.require('ol.renderer.Map');
goog.require('ol.renderer.canvas.ImageLayer');
goog.require('ol.renderer.canvas.Layer');
goog.require('ol.renderer.canvas.TileLayer');
goog.require('ol.renderer.canvas.VectorLayer');
goog.require('ol.renderer.canvas.VectorTileLayer');
goog.require('ol.source.State');


/**
 * @constructor
 * @extends {ol.renderer.Map}
 * @param {Element} container Container.
 * @param {ol.Map} map Map.
 */
ol.renderer.canvas.Map = function(container, map) {

  ol.renderer.Map.call(this, container, map);

  /**
   * @private
   * @type {CanvasRenderingContext2D}
   */
  this.context_ = ol.dom.createCanvasContext2D();

  /**
   * @private
   * @type {HTMLCanvasElement}
   */
  this.canvas_ = this.context_.canvas;

  this.canvas_.style.width = '100%';
  this.canvas_.style.height = '100%';
  this.canvas_.className = ol.css.CLASS_UNSELECTABLE;
  container.insertBefore(this.canvas_, container.childNodes[0] || null);

  /**
   * @private
   * @type {boolean}
   */
  this.renderedVisible_ = true;

  /**
   * @private
   * @type {ol.Transform}
   */
  this.transform_ = ol.transform.create();

};
ol.inherits(ol.renderer.canvas.Map, ol.renderer.Map);


/**
 * @inheritDoc
 */
ol.renderer.canvas.Map.prototype.createLayerRenderer = function(layer) {
  if (ol.ENABLE_IMAGE && layer instanceof ol.layer.Image) {
    return new ol.renderer.canvas.ImageLayer(layer);
  } else if (ol.ENABLE_TILE && layer instanceof ol.layer.Tile) {
    return new ol.renderer.canvas.TileLayer(layer);
  } else if (ol.ENABLE_VECTOR_TILE && layer instanceof ol.layer.VectorTile) {
    return new ol.renderer.canvas.VectorTileLayer(layer);
  } else if (ol.ENABLE_VECTOR && layer instanceof ol.layer.Vector) {
    return new ol.renderer.canvas.VectorLayer(layer);
  } else {
    goog.asserts.fail('unexpected layer configuration');
    return null;
  }
};


/**
 * @param {ol.render.EventType} type Event type.
 * @param {olx.FrameState} frameState Frame state.
 * @private
 */
ol.renderer.canvas.Map.prototype.dispatchComposeEvent_ = function(type, frameState) {
  var map = this.getMap();
  var context = this.context_;
  if (map.hasListener(type)) {
    var extent = frameState.extent;
    var pixelRatio = frameState.pixelRatio;
    var viewState = frameState.viewState;
    var rotation = viewState.rotation;

    var transform = this.getTransform(frameState);

    var vectorContext = new ol.render.canvas.Immediate(context, pixelRatio,
        extent, transform, rotation);
    var composeEvent = new ol.render.Event(type, map, vectorContext,
        frameState, context, null);
    map.dispatchEvent(composeEvent);
  }
};


/**
 * @param {olx.FrameState} frameState Frame state.
 * @protected
 * @return {!ol.Transform} Transform.
 */
ol.renderer.canvas.Map.prototype.getTransform = function(frameState) {
  var pixelRatio = frameState.pixelRatio;
  var viewState = frameState.viewState;
  var resolution = viewState.resolution;
  var transform = ol.transform.reset(this.transform_);
  ol.transform.translate(transform,
      this.canvas_.width / 2, this.canvas_.height / 2);
  ol.transform.scale(transform,
      pixelRatio / resolution, -pixelRatio / resolution);
  ol.transform.rotate(transform, -viewState.rotation);
  return ol.transform.translate(transform,
      -viewState.center[0], -viewState.center[1]);
};


/**
 * @inheritDoc
 */
ol.renderer.canvas.Map.prototype.getType = function() {
  return ol.RendererType.CANVAS;
};


/**
 * @inheritDoc
 */
ol.renderer.canvas.Map.prototype.renderFrame = function(frameState) {

  if (!frameState) {
    if (this.renderedVisible_) {
      this.canvas_.style.display = 'none';
      this.renderedVisible_ = false;
    }
    return;
  }

  var context = this.context_;
  var pixelRatio = frameState.pixelRatio;
  var width = Math.round(frameState.size[0] * pixelRatio);
  var height = Math.round(frameState.size[1] * pixelRatio);
  if (this.canvas_.width != width || this.canvas_.height != height) {
    this.canvas_.width = width;
    this.canvas_.height = height;
  } else {
    context.clearRect(0, 0, width, height);
  }

  var rotation = frameState.viewState.rotation;

  this.calculateMatrices2D(frameState);

  this.dispatchComposeEvent_(ol.render.EventType.PRECOMPOSE, frameState);

  var layerStatesArray = frameState.layerStatesArray;
  ol.array.stableSort(layerStatesArray, ol.renderer.Map.sortByZIndex);

  ol.render.canvas.rotateAtOffset(context, rotation, width / 2, height / 2);

  var viewResolution = frameState.viewState.resolution;
  var i, ii, layer, layerRenderer, layerState;
  for (i = 0, ii = layerStatesArray.length; i < ii; ++i) {
    layerState = layerStatesArray[i];
    layer = layerState.layer;
    layerRenderer = this.getLayerRenderer(layer);
    goog.asserts.assertInstanceof(layerRenderer, ol.renderer.canvas.Layer,
        'layerRenderer is an instance of ol.renderer.canvas.Layer');
    if (!ol.layer.Layer.visibleAtResolution(layerState, viewResolution) ||
        layerState.sourceState != ol.source.State.READY) {
      continue;
    }
    if (layerRenderer.prepareFrame(frameState, layerState)) {
      layerRenderer.composeFrame(frameState, layerState, context);
    }
  }

  ol.render.canvas.rotateAtOffset(context, -rotation, width / 2, height / 2);

  this.dispatchComposeEvent_(
      ol.render.EventType.POSTCOMPOSE, frameState);

  if (!this.renderedVisible_) {
    this.canvas_.style.display = '';
    this.renderedVisible_ = true;
  }

  this.scheduleRemoveUnusedLayerRenderers(frameState);
  this.scheduleExpireIconCache(frameState);
};
