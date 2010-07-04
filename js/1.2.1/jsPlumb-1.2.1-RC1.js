/*
 * jsPlumb 1.2.1-RC1
 * 
 * Provides a way to visually connect elements on an HTML page.
 * 
 * Several enhancements are planned for 1.2.1:
 * 
 * - speed enhancements for dragging/animation (fewer element positioning lookups etc)
 * - the ability to label connectors
 * - the ability to interact with connectors/endpoints using the mouse
 * - the log function should hook up to the console of whichever browser it is in. or library.
 * - export current chart as one entire jpg (Canvas can export a jpg. we just need to stitch them together)
 * - reinstate the context node to put all our canvases in
 * - possibly support multiple jsplumb instances on the same page.  this would not be too hard;
 *   it would just need to stop being a singleton.
 * - support for devices with touch events. 
 * 
 * http://morrisonpitt.com/jsPlumb/demo.html
 * http://code.google.com/p/jsPlumb
 * 
 */ 

(function() {
	
	var ie = (/MSIE/.test(navigator.userAgent) && !window.opera);
	
	var log = null;
	
	var repaintFunction = function() { jsPlumb.repaintEverything(); };
	var automaticRepaint = true;
    function repaintEverything() {
    	if (automaticRepaint)
    		repaintFunction();
    };
    var resizeTimer = null;        
	
	/**
	 * map of element id -> endpoint lists.  an element can have an arbitrary number of endpoints on it,
	 * and not all of them have to be connected to anything.
	 */
	var endpointsByElement = {};
	var offsets = [];
	var floatingConnections = {};
	var draggableStates = {};
	var _draggableByDefault = true;
	var sizes = [];
	
	var DEFAULT_NEW_CANVAS_SIZE = 1200; // only used for IE; a canvas needs a size before the init call to excanvas (for some reason. no idea why.)		
	
	var _findIndex = function( a, v, b, s ) {		
		var _eq = function(o1, o2) {
			if (o1 === o2) return true;
			else if (typeof o1 == 'object' && typeof o2 == 'object') {
				var same = true;
				for(var propertyName in o1) {				
					if(!_eq(o1[propertyName], o2[propertyName])) {
						same = false;
				        break;
				    }
				}
				for(var propertyName in o2) {				
					if(!_eq(o2[propertyName], o1[propertyName])) {
						same = false;
					   	break;
					}
				}
				return same;			
			}	
		};
		
		 for( var i = +b || 0, l = a.length; i < l; i++ ) {
			 if( _eq(a[i], v)) return i; 
		 }
		 return -1;
	};
	
	/**
     * helper method to add an item to a list, creating the list if it does not yet exist.
     */
    var _addToList = function(map, key, value) {
		var l = map[key];
		if (l == null) {
			l = [];
			map[key] = l; 
		}
		l.push(value);
	};
	
    /**
     * Handles the dragging of an element.  
     * @param element jQuery element
     * @param ui UI object from current library's event system
     */
    var _draw = function(element, ui) {
    	var id = _getAttribute(element, "id");
    	var endpoints = endpointsByElement[id];
    	if (endpoints) {
    		_updateOffset(id, ui);
    		var myOffset = offsets[id];
			var myWH = sizes[id];
	    	// loop through endpoints for this element
	    	for (var i = 0; i < endpoints.length; i++) {
	    		var e = endpoints[i];	    		
	    		var anchorLoc = endpoints[i].anchor.compute([myOffset.left, myOffset.top], myWH);
	            e.paint(anchorLoc);
	            var l = e.connections;
		    	for (var j = 0; j < l.length; j++)
		    		l[j].paint(id, ui);  // ...and paint them.
	    	}
    	}
    };
    
    /**
	 * helper function: the second argument is a function taking two args - the first is an id
	 * ui element from the current library (or list of them), and the second is the function
	 * to run.
	 */
	var _elementProxy = function(element, fn) {
		var retVal = null;
		if (typeof element == 'object' && element.length) {
			retVal = [];
    		for (var i = 0; i < element.length; i++) {
    			var el = _getElementObject(element[i]);
    	    	var id = _getAttribute(el, "id");
    			retVal.push(fn(el, id));  // append return values to what we will return
    		}
    	}
    	else {
	    	var el = _getElementObject(element);
	    	var id = _getAttribute(el, "id");
	    	retVal = fn(el, id);
    	}
		
		return retVal;
	};
	
	/**
	 * gets the named attribute from the given element (id or element object)
	 */
	var _getAttribute = function(el, attName) {
		var ele = jsPlumb.CurrentLibrary.getElementObject(el);
		return jsPlumb.CurrentLibrary.getAttribute(ele, attName);
	};
	
	var _setAttribute = function(el, attName, attValue) {
		var ele = jsPlumb.CurrentLibrary.getElementObject(el);
		jsPlumb.CurrentLibrary.setAttribute(ele, attName, attValue);
	};
	
	var _addClass = function(el, clazz) {
		var ele = jsPlumb.CurrentLibrary.getElementObject(el);
		jsPlumb.CurrentLibrary.addClass(ele, clazz);
	};
	
	var _getElementObject = function(elId) {
		return jsPlumb.CurrentLibrary.getElementObject(elId);
	};
	
	var _getOffset = function(el) {
		var ele = jsPlumb.CurrentLibrary.getElementObject(el);
		return jsPlumb.CurrentLibrary.getOffset(ele);
	};
	
	var _getSize = function(el) {
		var ele = jsPlumb.CurrentLibrary.getElementObject(el);
		return jsPlumb.CurrentLibrary.getSize(ele);
	};							
	
	var _appendCanvas = function(canvas) {
		document.body.appendChild(canvas);
	};
	
    /**
	 * gets an id for the given element, creating and setting one if necessary.
	 */
	var _getId = function(element) {
		var id = _getAttribute(element, "id");
		if (!id) {
			id = "_jsPlumb_" + new String((new Date()).getTime());
			_setAttribute(element, "id", id);
		}
		return id;
	};
    
    /**
     * inits a draggable if it's not already initialised.
     * 
     * TODO: we need to hook in each library to this method.  they need to be given the opportunity to
     * wrap/insert lifecycle functions, because each library does different things.  for instance, jQuery
     * supports the notion of 'revert', which will clean up a dragged endpoint; MooTools does not.  jQuery
     * also supports 'opacity' and MooTools does not; jQuery supports z-index of the draggable; MooTools
     * does not. i could go on.  the point is...oh.  initDraggable can do this.  ok. 
     */
	var _initDraggableIfNecessary = function(element, elementId, isDraggable, dragOptions) {
    	// dragging
	    var draggable = isDraggable == null ? _draggableByDefault : isDraggable;
	    if (draggable && jsPlumb.CurrentLibrary.isDragSupported(element)) {    	
	    	var options = dragOptions || jsPlumb.Defaults.DragOptions;
	    	options = jsPlumb.extend({}, options);  // make a copy.
	    	var dragEvent = jsPlumb.CurrentLibrary.dragEvents['drag'];
	    	var initDrag = function(element, elementId, dragFunc) {	    	
	    		options[dragEvent] = _wrap(options[dragEvent], dragFunc);
	    		var draggable = draggableStates[elementId];
	    		// TODO: this is still jQuery specific.
	    		options.disabled = draggable == null ? false : !draggable;
	    		jsPlumb.CurrentLibrary.initDraggable(element, options);
	    	};
	    	initDrag(element, elementId, function() {
	    		var ui = jsPlumb.CurrentLibrary.getUIPosition(arguments);
	    		_draw(element, ui);	
	    		_addClass(element, "jsPlumb_dragged");
	    	});
	    }    	
    };
    
    var _log = function(msg) {
    // not implemented. yet.	
    }
    
    /**
     * helper to create a canvas.
     * @param clazz optional class name for the canvas.
     */
    var _newCanvas = function(clazz) {
        var canvas = document.createElement("canvas");
        _appendCanvas(canvas);
        canvas.style.position="absolute";
        if (clazz) { canvas.className=clazz; }
        _getId(canvas); // set an id.
        
        if (ie) {
        	// for IE we have to set a big canvas size. actually you can override this, too, if 1200 pixels
        	// is not big enough for the biggest connector/endpoint canvas you have at startup.
        	jsPlumb.sizeCanvas(canvas, 0, 0, DEFAULT_NEW_CANVAS_SIZE, DEFAULT_NEW_CANVAS_SIZE);
        	canvas = G_vmlCanvasManager.initElement(canvas);          
        }
        
        return canvas;
    };  
    /**
     * performs the given function operation on all the connections found for the given element
     * id; this means we find all the endpoints for the given element, and then for each endpoint
     * find the connectors connected to it. then we pass each connection in to the given
     * function.
     */
    var _operation = function(elId, func) {
    	var endpoints = endpointsByElement[elId];
    	if (endpoints && endpoints.length) {
	    	for (var i = 0; i < endpoints.length; i++) {
	    		for (var j = 0; j < endpoints[i].connections.length; j++) {
	    			var retVal = func(endpoints[i].connections[j]);
	    			// if the function passed in returns true, we exit.
	    			// most functions return false.
	    			if (retVal) return;
	    		}
	    	}
    	}
    };
    /**
     * perform an operation on all elements.
     */
    var _operationOnAll = function(func) {
    	for (var elId in endpointsByElement) {
    		_operation(elId, func);
    	}    	
    };
    /**
     * helper to remove an element from the DOM.
     */
    var _removeElement = function(element) {
    	if (element != null) { 
    		try { document.body.removeChild(element); }
    		catch (e) { }
    	}    	
    };
    /**
     * helper to remove a list of elements from the DOM.
     */
    var _removeElements = function(elements) {
    	for (var i in elements)
    		_removeElement(elements[i]);
    };
	/**
     * helper method to remove an item from a list.
     */
    var _removeFromList = function(map, key, value) {
		var l = map[key];
		if (l != null) {
			var i = _findIndex(l, value);
			if (i >= 0) {
				delete( l[i] );
				l.splice( i, 1 );
				return true;
			}
		}		
		return false;
	};
	/**
     * Sets whether or not the given element(s) should be draggable, regardless of what a particular
     * plumb command may request.
     * 
     * @param element May be a string, a jQuery elements, or a list of strings/jquery elements.
     * @param draggable Whether or not the given element(s) should be draggable.
     */
	var _setDraggable = function(element, draggable) {    
    	var _helper = function(el, id) {
    		draggableStates[id] = draggable;
        	if (jsPlumb.CurrentLibrary.isDragSupported(el)) {
        		jsPlumb.CurrentLibrary.setDraggable(el, draggable);
        	}
    	};       
    	
    	return _elementProxy(element, _helper);
    };
	/**
	 * private method to do the business of hiding/showing.
	 * @param el either Id of the element in question or a jquery object for the element.
	 * @param state String specifying a value for the css 'display' property ('block' or 'none').
	 */
	var _setVisible = function(el, state) {
		var elId = _getAttribute(el, "id");
	    var f = function(jpc) {
	    	jpc.canvas.style.display = state;
	    };    	
    	_operation(elId, f);
    };        
    /**
     * toggles the draggable state of the given element(s).
     * @param el either an id, or a jquery object, or a list of ids/jquery objects.
     */
    var _toggleDraggable = function(el) {    	
    	var fn = function(el, elId) {
    		var state = draggableStates[elId] == null ? _draggableByDefault : draggableStates[elId];
	    	state = !state;
	    	draggableStates[elId] = state;
	    	jsPlumb.CurrentLibrary.setDraggable(el, state);
	    	return state;
    	};
    	return _elementProxy(el, fn);
    };
    /**
    * private method to do the business of toggling hiding/showing.
    * @param elId Id of the element in question
    */
	var _toggleVisible = function(elId) {
    	var f = function(jpc) {
    		var state = ('none' == jpc.canvas.style.display);
    		jpc.canvas.style.display = state ? "block" : "none";
    	};
    	
    	_operation(elId, f);
    	
    	//todo this should call _elementProxy, and pass in the _operation(elId, f) call as a function. cos _toggleDraggable does that.
    };
    /**
     * updates the offset and size for a given element, and stores the values.
     * if 'offset' is not null we use that (it would have been passed in from a drag call) because it's faster; but if it is null,
     * or if 'recalc' is true in order to force a recalculation, we use the offset, outerWidth and outerHeight methods to get
     * the current values.
     */
    var _updateOffset = function(elId, offset, recalc) {    	
		if (recalc || offset == null) {  // if forced repaint or no offset available, we recalculate.
    		// get the current size and offset, and store them
    		var s = _getElementObject(elId);
    		sizes[elId] = _getSize(elId);
    		offsets[elId] = _getOffset(elId);
		} else {			 
    		offsets[elId] = offset;
		}
	};
		
    /**
     * wraps one function with another, creating a placeholder for the wrapped function
     * if it was null.  this is used to wrap the various drag/drop event functions - to allow
     * jsPlumb to be notified of important lifecycle events without imposing itself on the user's
     * drap/drop functionality.
     * TODO: determine whether or not we should support an error handler concept, if one of the functions fails.
     */
    var _wrap = function(wrappedFunction, newFunction) {
    	wrappedFunction = wrappedFunction || function() { };
    	newFunction = newFunction || function() { };
    	return function() {
    		try { newFunction.apply(this, arguments); }
    		catch (e) { 
    			_log('jsPlumb function failed : ' + e);
    		}
    		try { wrappedFunction.apply(this, arguments); }
    		catch (e) { 
    			_log('wrapped function failed : ' + e);    			
    		}
    	};
    }
    
    /*
     Class: Anchor     
     Models a position relative to the origin of some element that an Endpoint can be located.     
     */
	/*
	 Function: Anchor
	 
       Constructor for the Anchor class	 
	  
	   Parameters:
	   	params - Anchor parameters. This should contain three values, and may optionally have an 'offsets' argument:
	  
	 	- x : the x location of the anchor as a fraction of the total width.
	    - y : the y location of the anchor as a fraction of the total height.
	    - orientation : an [x,y] array indicating the general direction a connection from the anchor should go in. for more info on this, see the documentation, or the docs in jquery-jsPlumb-defaults-XXX.js for the default Anchors.
	 	- offsets : an [x,y] array of fixed offsets that should be applied after the x,y position has been figured out.  may be null.
	 */	
	var Anchor = function(params) {
		var self = this;
		this.x = params.x || 0; this.y = params.y || 0; 
		var orientation = params.orientation || [0,0];
		this.offsets = params.offsets || [0,0];
		this.compute = function(xy, wh, txy, twh) {
			return [ xy[0] + (self.x * wh[0]) + self.offsets[0], xy[1] + (self.y * wh[1]) + self.offsets[1] ];
		}
		this.getOrientation = function() { return orientation; };
	};
		 
	/**
	 * An Anchor that floats.  its orientation is computed dynamically from its position relative to the anchor it is floating relative to.
	 *  
	 */
	var FloatingAnchor = function(params) {
		
		// this is the anchor that this floating anchor is referenced to for purposes of calculating the orientation.
		var ref = params.reference;
		// the canvas this refers to.
		var refCanvas = params.referenceCanvas;
		var size = _getSize(refCanvas);		
		
		// these are used to store the current relative position of our anchor wrt the reference anchor.  they only indicate
		// direction, so have a value of 1 or -1 (or, very rarely, 0).  these values are written by the compute method, and read
		// by the getOrientation method.
		var xDir = 0, yDir = 0; 
		// temporary member used to store an orientation when the floating anchor is hovering over another anchor.
		var orientation = null;
		
		this.compute = function(xy, wh, txy, twh) {
			// set these for the getOrientation method to use.
			xDir = 0;//xy[0] < txy[0] ? -1 : xy[0] == txy[0] ? 0 : 1;
			yDir = 0;//xy[1] < txy[1] ? -1 : xy[1] == txy[1] ? 0 : 1;
			return [xy[0] + (size[0] / 2), xy[1] + (size[1] / 2) ];  // return origin of the element.  we may wish to improve this so that any object can be the drag proxy.
		};
		
		this.getOrientation = function() {
			if (orientation) return orientation;
			else {
				var o = ref.getOrientation();
				// here we take into account the orientation of the other anchor: if it declares zero for some direction, we declare zero too.
				// this might not be the most awesome.  perhaps we can come up with a better way.  it's just so that the line we draw looks
				// like it makes sense.  maybe this wont make sense.
				return [Math.abs(o[0]) * xDir * -1, Math.abs(o[1]) * yDir * -1];
			}
		};
		
		/**
		 * notification the endpoint associated with this anchor is hovering over another anchor; 
		 * we want to assume that anchor's orientation for the duration of the hover. 
		 */
		this.over = function(anchor) {
			orientation = anchor.getOrientation();			
		};
		
		/**
		 * notification the endpoint associated with this anchor is no longer hovering 
		 * over another anchor; we should resume calculating orientation as we normally do.
		 */
		this.out = function() {
			orientation = null;
		};
	};
	
	// ************** connection
	// ****************************************
	/**
	* allowed params:
	* source:	source element (string or a jQuery element) (required)
	* target:	target element (string or a jQuery element) (required)
	* 
	* anchors: optional array of anchor placements. defaults to BottomCenter for source
	*          and TopCenter for target.
	*/
	var Connection = function(params) {

	// ************** get the source and target and register the connection. *******************
	    var self = this;
	    // get source and target as jQuery objects
	    this.source = _getElementObject(params.source);    
	    this.target = _getElementObject(params.target);
	    this.sourceId = _getAttribute(this.source, "id");	    
	    this.targetId = _getAttribute(this.target, "id");
	    this.endpointsOnTop = params.endpointsOnTop != null ? params.endpointsOnTop : true;	    
	    
	    // init endpoints
	    this.endpoints = [];
	    this.endpointStyles = [];
	    var prepareEndpoint = function(existing, index, params) {
	    	if (existing) self.endpoints[index] = existing;
		    else {
		    	if(!params.endpoints) params.endpoints = [null,null];
			    var ep = params.endpoints[index] || params.endpoint || jsPlumb.Defaults.Endpoints[index] || jsPlumb.Defaults.Endpoint|| new jsPlumb.Endpoints.Dot();
			    if (!params.endpointStyles) params.endpointStyles = [null,null];
			    var es = params.endpointStyles[index] || params.endpointStyle || jsPlumb.Defaults.EndpointStyles[index] || jsPlumb.Defaults.EndpointStyle;
			    var a = params.anchors  ? params.anchors[index] : jsPlumb.Defaults.Anchors[index] || jsPlumb.Anchors.BottomCenter;
			    self.endpoints[index] = new Endpoint({style:es, endpoint:ep, connections:[self], anchor:a, source:self.source });	    	
		    }
	    };
	    
	    prepareEndpoint(params.sourceEndpoint, 0, params);
	    prepareEndpoint(params.targetEndpoint, 1, params);
	    
	    this.connector = this.endpoints[0].connector || this.endpoints[1].connector || params.connector || jsPlumb.Defaults.Connector || new jsPlumb.Connectors.Bezier();
	    this.paintStyle = this.endpoints[0].connectorStyle  || this.endpoints[1].connectorStyle || params.paintStyle || jsPlumb.Defaults.PaintStyle;
	    	    	    	   
	    _updateOffset(this.sourceId);
	    _updateOffset(this.targetId);
	    
	    // paint the endpoints
	    var myOffset = offsets[this.sourceId], myWH = sizes[this.sourceId];		
    	var anchorLoc = this.endpoints[0].anchor.compute([myOffset.left, myOffset.top], myWH);
    	this.endpoints[0].paint(anchorLoc);    	
    	myOffset = offsets[this.targetId]; myWH = sizes[this.targetId];		
    	anchorLoc = this.endpoints[1].anchor.compute([myOffset.left, myOffset.top], myWH);
    	this.endpoints[1].paint(anchorLoc);

	// *************** create canvas on which the connection will be drawn ************
	    var canvas = _newCanvas(jsPlumb.connectorClass);
	    this.canvas = canvas;
	     
	    /**
	     * paints the connection.
	     * @param elId Id of the element that is in motion
	     * @param ui current library's event system ui object (present if we came from a drag to get here)
	     * @param recalc whether or not to recalculate element sizes. this is true if a repaint caused this to be painted.
	     */
	    this.paint = function(elId, ui, recalc) {    	
	    	
	    	if (log) log.debug("Painting Connection; element in motion is " + elId + "; ui is [" + ui + "]; recalc is [" + recalc + "]");
	    	
	    	var fai = self.floatingAnchorIndex;
	    	// if the moving object is not the source we must transpose the two references.
	    	var swap = !(elId == this.sourceId);
	    	var tId = swap ? this.sourceId : this.targetId, sId = swap ? this.targetId : this.sourceId;
	    	var tIdx = swap ? 0 : 1, sIdx = swap ? 1 : 0;
	    	var el = swap ? this.target : this.source;
	    	
	    	if (this.canvas.getContext) {    		    		
	    		    		
	    		_updateOffset(elId, ui, recalc);
	    		if (recalc) _updateOffset(tId);  // update the target if this is a forced repaint. otherwise, only the source has been moved.
	    		
	    		var myOffset = offsets[elId]; 
	    		var otherOffset = offsets[tId];
	    		var myWH = sizes[elId];
	            var otherWH = sizes[tId];
	            
	    		var ctx = canvas.getContext('2d');
	            var sAnchorP = this.endpoints[sIdx].anchor.compute([myOffset.left, myOffset.top], myWH, [otherOffset.left, otherOffset.top], otherWH);
	            var sAnchorO = this.endpoints[sIdx].anchor.getOrientation();
	            var tAnchorP = this.endpoints[tIdx].anchor.compute([otherOffset.left, otherOffset.top], otherWH, [myOffset.left, myOffset.top], myWH);
	            var tAnchorO = this.endpoints[tIdx].anchor.getOrientation();
	            var dim = this.connector.compute(sAnchorP, tAnchorP, this.endpoints[sIdx].anchor, this.endpoints[tIdx].anchor, this.paintStyle.lineWidth);
	            jsPlumb.sizeCanvas(canvas, dim[0], dim[1], dim[2], dim[3]);
	            jsPlumb.extend(ctx, this.paintStyle);
	                        
	            if (this.paintStyle.gradient && !ie) { 
		            var g = swap ? ctx.createLinearGradient(dim[4], dim[5], dim[6], dim[7]) : ctx.createLinearGradient(dim[6], dim[7], dim[4], dim[5]);
		            for (var i = 0; i < this.paintStyle.gradient.stops.length; i++)
		            	g.addColorStop(this.paintStyle.gradient.stops[i][0],this.paintStyle.gradient.stops[i][1]);
		            ctx.strokeStyle = g;
	            }
	            	            
	            this.connector.paint(dim, ctx);	                            
	    	}
	    };
	    
	    this.repaint = function() {
	    	this.paint(this.sourceId, null, true);
	    };

	    _initDraggableIfNecessary(self.source, self.sourceId, params.draggable, params.dragOptions);
	    _initDraggableIfNecessary(self.target, self.targetId, params.draggable, params.dragOptions);
	    	    
	    // resizing (using the jquery.ba-resize plugin). todo: decide whether to include or not.
	    if (this.source.resize) {
	    	this.source.resize(function(e) {
	    		jsPlumb.repaint(self.sourceId);
	    	});
	    }
	};
	
	/*
	 Class: Endpoint 
	 
	 Models an endpoint.  Can have one to N connections emanating from it (although how to handle that in the UI is 
	 a very good question). also has a Canvas and paint style.
	  	 
	 */
	
	/* 
	 Function: Endpoint
	 
	 This is the Endpoint class constructor.
	 
	 Parameters:
	  
	  anchor			-	anchor for the endpoint, of type jsPlumb.Anchor. may be null. 
	  endpoint 		- 	endpoint object, of type jsPlumb.Endpoint. may be null.
	  style			-	endpoint style, a js object. may be null.
	  source			-	element the endpoint is attached to, of type jquery object.  Required.
	  canvas			-	canvas element to use. may be, and most often is, null.
	  connections  	-	optional list of connections to configure the endpoint with.
	  isSource			-	boolean. indicates the endpoint can act as a source of new connections. optional.
	  dragOptions		-	if isSource is set to true, you can supply arguments for the jquery draggable method.  optional.
	  connectionStyle	-	if isSource is set to true, this is the paint style for connections from this endpoint. optional.
	  connector		-	optional connector type to use.
	  isTarget			-	boolean. indicates the endpoint can act as a target of new connections. optional.
	  dropOptions		-	if isTarget is set to true, you can supply arguments for the jquery droppable method.  optional.
	  reattach			-	optional boolean that determines whether or not the connections reattach after they
	                       have been dragged off an endpoint and left floating.  defaults to false: connections
	                       dropped in this way will just be deleted.
	*/ 
	var Endpoint = function(params) {
		params = params || {};
		// make a copy. then we can use the wrapper function.
		jsPlumb.extend({}, params);
		var self = this;
		self.anchor = params.anchor || jsPlumb.Anchors.TopCenter;
		var _endpoint = params.endpoint || new jsPlumb.Endpoints.Dot();
		var _style = params.style || jsPlumb.Defaults.EndpointStyle;
		this.connectorStyle = params.connectorStyle;
		this.connector = params.connector;
		var _element = params.source;
		var _elementId = _getAttribute(_element, "id");
		var _maxConnections = params.maxConnections || 1;                     // maximum number of connections this endpoint can be the source of.
		this.canvas = params.canvas || _newCanvas(jsPlumb.endpointClass);
		this.connections = params.connections || [];
		var _reattach = params.reattach || false;
		var floatingEndpoint = null;
		var inPlaceCopy = null;
		this.addConnection = function(connection) {
			
			self.connections.push(connection);
		};
		this.removeConnection = function(connection) {
			var idx = _findIndex(self.connections, connection);
			if (idx >= 0)
				self.connections.splice(idx, 1);
		};
		this.makeInPlaceCopy = function() {
			var e = new Endpoint({anchor:self.anchor, source:_element, style:_style, endpoint:_endpoint});
			return e;
		};
		/**
		* returns whether or not this endpoint is connected to the given endpoint.
		* @param endpoint  Endpoint to test.
		* @since 1.1.1
		*
		* todo: needs testing.  will this work if the endpoint passed in is the source?
		*/
		this.isConnectedTo = function(endpoint) {
			var found = false;
			if (endpoint) {
				for (var i = 0; i < self.connections.length; i++) {
			  		if (self.connections[i].endpoints[1] == endpoint) {
			  		 	found = true;
			  		 	break;
			  		}
				}		
			}
			return found;
		};
		
		this.isFloating = function() { return floatingEndpoint != null; };
		/**
		 * first pass at default ConnectorSelector: returns the first connection, if we have any.
		 * modified a little, 5/10/2010: now it only returns a connector if we have not got equal to or more than _maxConnector connectors
		 * attached.  otherwise it is assumed a new connector is ok.  but note with this setup we can't select any other connection than the first
		 * one.  what if this could return a list?  that implies everything should work with a list - dragging etc. could be nasty. could also
		 * be cool.
		 */
		var connectorSelector = function() {
			return self.connections.length == 0 || self.connections.length < _maxConnections ?  null : self.connections[0]; 
		};
		
		this.isFull = function() { return _maxConnections < 1 ? false : (self.connections.length >= _maxConnections); }; 
		
		/**
		 * paints the Endpoint, recalculating offset and anchor positions if necessary.
		 */
		this.paint = function(anchorPoint, connectorPaintStyle, canvas) {
			
			if (log) log.debug("Painting Endpoint with elementId [" + _elementId + "]; anchorPoint is [" + anchorPoint + "]");
			
			if (anchorPoint == null) {
				// do we always want to force a repaint here?  i dont think so!
				var xy = offsets[_elementId];
				var wh = sizes[_elementId];
				if (xy == null || wh == null) {
					_updateOffset(_elementId);
					xy = offsets[_elementId];
					wh = sizes[_elementId];
				}
				anchorPoint = self.anchor.compute([xy.left, xy.top], wh);
			}
			_endpoint.paint(anchorPoint, self.anchor.getOrientation(), canvas || self.canvas, _style, connectorPaintStyle || _style);
		};
		
		
		// is this a connection source? we make it draggable and have the drag listener 
		// maintain a connection with a floating endpoint.
		if (params.isSource && jsPlumb.CurrentLibrary.isDragSupported(_element)) {
			
			var n = null, id = null, jpc = null, existingJpc = false, existingJpcParams = null;
			
			// first the question is, how many connections are on this endpoint?  if it's only one, then excellent.  otherwise we will either need a way
			// to select one connection from the list, or drag them all. if we had a pluggable 'ConnectorSelector' interface we could probably
			// provide a way for people to implement their own UI components to do the connector selection.  the question in that particular case would be how much
			// information the interface needs from jsPlumb at execution time. if, however, we leave out the connector selection, and drag them all,
			// that wouldn't be too hard to organise. perhaps that behaviour would be on a switch for the endpoint, or perhaps the ConnectorSelector
			// interface returns a List, with the default implementation just returning everything.  i think i like that.
			//
			// let's say for now that there is just one endpoint, cos we need to get this going before we can consider a list of them anyway.
			// the major difference between that case and the case of a new endpoint is actually quite small - it's a question of where the
			// Connection comes from.  for a new one, we create a new one. obviously.  otherwise we just get the jpc from the Endpoint
			// (remember we're only assuming one connection right now).  so all of the UI stuff we do to create the floating endpoint etc
			// will still be valid, but when we stop dragging, we'll have to do something different.  if we stop with a valid drop i think it will
			// be the same process.  but if we stop with an invalid drop we have to reset the Connection to how it was when we got it.
			var start = function() {
				
				inPlaceCopy = self.makeInPlaceCopy();
				inPlaceCopy.paint();
				
				n = document.createElement("div");
				_appendCanvas(n);
				// create and assign an id, and initialize the offset.
				var id = "" + new String(new Date().getTime());
				_setAttribute(_getElementObject(n), "id", id);
				_updateOffset(id);
				// store the id of the dragging div and the source element. the drop function
				// will pick these up.
				_setAttribute(_getElementObject(self.canvas), "dragId", id);
				_setAttribute(_getElementObject(self.canvas), "elId", _elementId);
				// create a floating anchor
				var floatingAnchor = new FloatingAnchor({reference:self.anchor, referenceCanvas:self.canvas});
				floatingEndpoint = new Endpoint({
					style:{fillStyle:'rgba(0,0,0,0)'},
					endpoint:_endpoint, 
					anchor:floatingAnchor, 
					source:n 
				});
				
				jpc = connectorSelector();
				if (jpc == null) {
					// create a connection. one end is this endpoint, the other is a floating endpoint.
					jpc = new Connection({
						sourceEndpoint:self, 
						targetEndpoint:floatingEndpoint,
						source:_getElementObject(_element),
						target:_getElementObject(n),
						anchors:[self.anchor, floatingAnchor],
						paintStyle : params.connectorStyle, // this can be null. Connection will use the default.
						connector: params.connector
					});
					// todo ...unregister on stop
					self.addConnection(jpc);
				} else {
					existingJpc = true;
					var anchorIdx = jpc.sourceId == _elementId ? 0 : 1;
					jpc.floatingAnchorIndex = anchorIdx;
					// probably we should remove the connection? and add it back if the user
					// does not drop it somewhere proper.
					self.removeConnection(jpc);
					if (anchorIdx == 0){
						existingJpcParams = [jpc.source, jpc.sourceId];
						jpc.source = _getElementObject(n);
						jpc.sourceId = id;						
					}else {
						existingJpcParams = [jpc.target, jpc.targetId];
						jpc.target = _getElementObject(n);
						jpc.targetId = id;
					}					
					
					jpc.suspendedEndpoint = jpc.endpoints[anchorIdx];
					jpc.endpoints[anchorIdx] = floatingEndpoint;
				}
				
				// register it.
				floatingConnections[id] = jpc;
				
				// todo unregister on stop
				floatingEndpoint.addConnection(jpc);
								
				// only register for the target endpoint; we will not be dragging the source at any time
				// before this connection is either discarded or made into a permanent connection.
				_addToList(endpointsByElement, id, floatingEndpoint);
				
			};			
			
			var dragOptions = params.dragOptions || { };
			
			var defaultOpts = jsPlumb.extend({}, jsPlumb.CurrentLibrary.defaultDragOptions);
			dragOptions = jsPlumb.extend(defaultOpts, dragOptions);
			var startEvent = jsPlumb.CurrentLibrary.dragEvents['start'];
			var stopEvent = jsPlumb.CurrentLibrary.dragEvents['stop'];
			var dragEvent = jsPlumb.CurrentLibrary.dragEvents['drag'];
			dragOptions[startEvent] = _wrap(dragOptions[startEvent], start);
			dragOptions[dragEvent] = _wrap(dragOptions[dragEvent], function() { 
				var _ui = jsPlumb.CurrentLibrary.getUIPosition(arguments);
				_draw(_getElementObject(n), _ui); 
			});
			dragOptions[stopEvent] = _wrap(dragOptions[stopEvent], 
				function() {					
					_removeFromList(endpointsByElement, id, floatingEndpoint);
					_removeElements([floatingEndpoint.canvas, n, inPlaceCopy.canvas]);
					var idx = jpc.floatingAnchorIndex == null ? 1 : jpc.floatingAnchorIndex;
					if (jpc.endpoints[idx] == floatingEndpoint) {										
						// if the connection was an existing one:
						if (existingJpc && jpc.suspendedEndpoint) {
							if (_reattach) {
								jpc.floatingAnchorIndex = null;
								if (idx == 0) {
									jpc.source = existingJpcParams[0];
									jpc.sourceId = existingJpcParams[1];																	
								} else {
									jpc.target = existingJpcParams[0];
									jpc.targetId = existingJpcParams[1];
								}
								jpc.endpoints[idx] = jpc.suspendedEndpoint;
								jpc.suspendedEndpoint.addConnection(jpc);
								jsPlumb.repaint(existingJpcParams[1]);
							}
							else {
								jpc.endpoints[0].removeConnection(jpc);
								jpc.endpoints[1].removeConnection(jpc);
								_removeElement(jpc.canvas);
							}
						} else {							
							_removeElement(jpc.canvas);
							self.removeConnection(jpc);
						}
					}
					jpc = null;
					delete floatingEndpoint;
					delete inPlaceCopy;
					self.paint();
				}			
			);		
							
			var i = _getElementObject(self.canvas);			
			jsPlumb.CurrentLibrary.initDraggable(i, dragOptions);
		};
		
		// connector target
		if (params.isTarget && jsPlumb.CurrentLibrary.isDropSupported(_element)) {
			var dropOptions = params.dropOptions || jsPlumb.Defaults.DropOptions;
			dropOptions = jsPlumb.extend({}, dropOptions);
	    	var originalAnchor = null;
	    	var dropEvent = jsPlumb.CurrentLibrary.dragEvents['drop'];
			var overEvent = jsPlumb.CurrentLibrary.dragEvents['over'];
			var outEvent = jsPlumb.CurrentLibrary.dragEvents['out'];
	    	dropOptions[dropEvent]= _wrap(dropOptions[dropEvent], function() {
	    		var draggable = jsPlumb.CurrentLibrary.getDragObject(arguments);
	    		var id = _getAttribute(_getElementObject(draggable), "dragId");
	    		var elId = _getAttribute(_getElementObject(draggable),"elId");
	    		var jpc = floatingConnections[id];
	    		var idx = jpc.floatingAnchorIndex == null ? 1 : jpc.floatingAnchorIndex;
	    		if (idx == 0) {
	    			jpc.source = _element;
		    		jpc.sourceId = _elementId;		    		
	    		} else {
		    		jpc.target = _element;
		    		jpc.targetId = _elementId;		    		
	    		}
	    		// remove this jpc from the current endpoint
	    		jpc.endpoints[idx].removeConnection(jpc);
	    		if (jpc.suspendedEndpoint)
	    			jpc.suspendedEndpoint.removeConnection(jpc);
	    		jpc.endpoints[idx] = self;
	    		self.addConnection(jpc);
	    		_initDraggableIfNecessary(_element, _elementId, params.draggable, {});
	    		jsPlumb.repaint(elId);
	    		
	    		delete floatingConnections[id];	    			    	
			 });
	    	
	    	dropOptions[overEvent]= _wrap(dropOptions[overEvent], function() { 
				var draggable = jsPlumb.CurrentLibrary.getDragObject(arguments);
				var id = _getAttribute(_getElementObject(draggable),"dragId");
		    	var jpc = floatingConnections[id];
		    	var idx = jpc.floatingAnchorIndex == null ? 1 : jpc.floatingAnchorIndex;  
		    	jpc.endpoints[idx].anchor.over(self.anchor);		    	
			 });
			 
			 dropOptions[outEvent] = _wrap(dropOptions[outEvent], function() {
				var draggable = jsPlumb.CurrentLibrary.getDragObject(arguments);
				var id = _getAttribute(_getElementObject(draggable),"dragId");
		    	var jpc = floatingConnections[id];
		    	var idx = jpc.floatingAnchorIndex == null ? 1 : jpc.floatingAnchorIndex;
		    	jpc.endpoints[idx].anchor.out();
			 });
			 		
			 jsPlumb.CurrentLibrary.initDroppable(_getElementObject(self.canvas), dropOptions);			
		}		
		
		return self;
	};
	
	/*
	 Class: jsPlumb 
	 
	 This is the main entry point to jsPlumb.  There are a bunch of static methods you can
	 use to connect/disconnect etc.  Some methods are also added to jQuery's "$.fn" object itself, but
	 in general jsPlumb is moving away from that model, preferring instead the static class
	 approach.  One of the reasons for this is that with no methods added to the jQuery $.fn object,
	 it will be easier to provide support for other libraries such as MooTools. 
	 */
    var jsPlumb = window.jsPlumb = {
    		
    	/*
    	 Property: Defaults
    	 
    	 These are the default settings for jsPlumb, that is what will be used if you do not supply specific pieces of information
    	 to the various API calls.  A convenient way to implement your own look and feel can be to override these defaults by including a script
    	 somewhere after the jsPlumb include, but before you make any calls to jsPlumb, for instance in this example we set the PaintStyle to be
    	 a blue line of 27 pixels:
    	     	 
    	 > jsPlumb.Defaults.PaintStyle = { lineWidth:27, strokeStyle:'blue' }
    	     	  
    	 */
    	Defaults : {
    		Anchors : [ null, null ],
    		Connector : null,
    		DragOptions: { },
    		DropOptions: { },
    		Endpoint : null,
    		Endpoints : [ null, null ],
    		EndpointStyle : { fillStyle : null },
    		EndpointStyles : [ null, null ],
    		MaxConnections : null,
    		PaintStyle : { lineWidth : 10, strokeStyle : 'red' },
    		Scope : "_jsPlumb_DefaultScope"
    	},
    	
    	/*
    	 Property: connectorClass
    	 
    	 The CSS class to set on Connection canvas elements.  This value is a String and can have multiple classes; the entire String is appended as-is.
    	 */
		connectorClass : '_jsPlumb_connector',
		
		/*
   	 	Property: endpointClass
   	 
   	 	The CSS class to set on Endpoint canvas elements.  This value is a String and can have multiple classes; the entire String is appended as-is.
		*/
		endpointClass : '_jsPlumb_endpoint',
		
		/*
		 Property: Anchors
		 
		 Default jsPlumb Anchors.  These are supplied in the file jquery.jsPlumb-defaults-x.x.x.js, which is merged in with the main jsPlumb script
		 to form jquery.jsPlumb-all-x.x.x.js.  You can provide your own Anchors by supplying them in a script that is loaded after jsPlumb, for instance:
		 
		 > jsPlumb.Anchors.MyAnchor = { ....anchor code here.  see the documentation. }
		 */
	    Anchors : {},
	    
	    /*
		 Property: Connectors
		 
		 Default jsPlumb Connectors.  These are supplied in the file jquery.jsPlumb-defaults-x.x.x.js, which is merged in with the main jsPlumb script
		 to form jquery.jsPlumb-all-x.x.x.js.  You can provide your own Connectors by supplying them in a script that is loaded after jsPlumb, for instance:
		 
		 > jsPlumb.Connectors.MyConnector = { ....connector code here.  see the documentation. }
		 */
	    Connectors : {},
	    
	    /*
		 Property: Endpoints
		 
		 Default jsPlumb Endpoints.  These are supplied in the file jquery.jsPlumb-defaults-x.x.x.js, which is merged in with the main jsPlumb script
		 to form jquery.jsPlumb-all-x.x.x.js.  You can provide your own Endpoints by supplying them in a script that is loaded after jsPlumb, for instance:
		 
		 > jsPlumb.Endpoints.MyEndpoint = { ....endpoint code here.  see the documentation. }
		 */
	    Endpoints : {},
	      
	    /*
	      Function: addEndpoint
	     
	      Adds an Endpoint to a given element.
	      
	      Parameters:
	        target - Element to add the endpoint to.  either an element id, or a jQuery object representing some element.
	        params - Object containing Endpoint options (more info required)
	        
	      Returns:
	      
	       The newly created Endpoint.
	       
	      See Also:
	      
	       <addEndpoints>
	     */
	    addEndpoint : function(target, params) {
	    	params = jsPlumb.extend({}, params);
	    	var el = _getElementObject(target);
	    	var id = _getAttribute(target,"id");
	    	params.source = el; 
	    	_updateOffset(id);
	    	var e = new Endpoint(params);
	    	_addToList(endpointsByElement, id, e);
    		var myOffset = offsets[id];
    		var myWH = sizes[id];			
	    	var anchorLoc = e.anchor.compute([myOffset.left, myOffset.top], myWH);
	    	e.paint(anchorLoc);
	    	return e;
	    },
	    
	    /*
	      Function: addEndpoint
	     
	      Adds a list of Endpoints to a given element.
	      
	      Parameters:
	      
	        target - element to add the endpoint to.  either an element id, or a jQuery object representing some element.
	        endpoints - List of objects containing Endpoint options. one Endpoint is created for each entry in this list.
	        
	      Returns:
	      
	        List of newly created Endpoints, one for each entry in the 'endpoints' argument.
	       
	      See Also:
	      
	       <addEndpoint>
	     */
	    addEndpoints : function(target, endpoints) {
	    	var results = [];
	    	for (var i = 0; i < endpoints.length; i++) {
	    		results.push(jsPlumb.addEndpoint(target, endpoints[i]));
	    	}
	    	return results;
	    },
	    
	    /*
	     Function: animate
	     
	     Wrapper around standard jQuery animate function; injects a call to jsPlumb in the 'step' function (creating it if necessary).  
	     This only supports the two-arg version of the animate call in jQuery - the one that takes an 'options' object as the second arg.
	     
	     Parameters:
	       
	       el - Element to animate.  Either an id, or a jQuery object representing the element.
	       properties - The 'properties' argument you want passed to the standard jQuery animate call.
	       options - The 'options' argument you want passed to the standard jQuery animate call.
	       
	     Returns:
	     
	      void
	    */	      
	    animate : function(el, properties, options) {
	    	var ele = _getElementObject(el);
	    	var id = _getAttribute(el,"id");
	    	//TODO this is not agnostic yet.
	    	options = options || {};
	    	var stepFunction = jsPlumb.CurrentLibrary.dragEvents['step'];
	    	options[stepFunction] = _wrap(options[stepFunction], function() 
	    	{
	    		jsPlumb.repaint(id); 
	    	});
	    	jsPlumb.CurrentLibrary.animate(ele, properties, options);    	
	    },
	    
	    /*
	     Function: connect
	     
	     Establishes a connection between two elements.
	     
	     Parameters:
	     
	     	params - Object containing setup for the connection.  see documentation.
	     	
	     Returns:
	     
	     	The newly created Connection.
	     	
	     */
	    connect : function(params) {
	    	if (params.sourceEndpoint && params.sourceEndpoint.isFull()) {
	    		_log("could not add connection; source endpoint is full");
	    		return;
	    	}
	    	
	    	if (params.targetEndpoint && params.targetEndpoint.isFull()) {
	    		_log("could not add connection; target endpoint is full");
	    		return;
	    	}
	    		
	    	var jpc = new Connection(params);    	
	    	
			// register endpoints for the element. todo: is the test below sufficient? or should we test if the endpoint is already in the list, 
		    // and add it only then?  perhaps _addToList could be overloaded with a a 'test for existence first' parameter?
			//_addToList(endpointsByElement, jpc.sourceId, jpc.endpoints[0]);
			//_addToList(endpointsByElement, jpc.targetId, jpc.endpoints[1]);
	
			if (!params.sourceEndpoint) _addToList(endpointsByElement, jpc.sourceId, jpc.endpoints[0]);
			if (!params.targetEndpoint) _addToList(endpointsByElement, jpc.targetId, jpc.endpoints[1]);
	
			jpc.endpoints[0].addConnection(jpc);
			jpc.endpoints[1].addConnection(jpc);
	
			// force a paint
			_draw(jpc.source);
			
			return jpc;
    	
	    },           
	    
	    /**
	    * not implemented yet. params object will have sourceEndpoint and targetEndpoint members; these will be Endpoints.
	    connectEndpoints : function(params) {
	    	var jpc = Connection(params);
	    	
	    },*/
	    
	    /* 
	     Function: detach
	      
	     Removes a connection.
	     
	     Parameters:
	     
	    	sourceId - Id of the first element in the connection. A String.
	    	targetId - iI of the second element in the connection. A String.
	    	
	    Returns:
	    
	    	true if successful, false if not.
	    */
	    detach : function(sourceId, targetId) {
	    	var f = function(jpc) {
	    		if ((jpc.sourceId == sourceId && jpc.targetId == targetId) || (jpc.targetId == sourceId && jpc.sourceId == targetId)) {
	    			_removeElement(jpc.canvas);
				jpc.endpoints[0].removeConnection(jpc);
				jpc.endpoints[1].removeConnection(jpc);
	    			return true;
	    		}    		
	    	};    	
	    	
	    	// todo: how to cleanup the actual storage?  a third arg to _operation?
	    	_operation(sourceId, f);    	
	    },
	    
	    /*
	     Function: detachAll 
	     
	     	Removes all an element's connections.
	     	
	     Parameters:
	     
	     	el - either the id of the element, or a jQuery object for the element.
	     	
	     Returns:
	     
	     	void
	     */
	    detachAll : function(el) {    	
	    	var id = _getAttribute(el, "id");	    	
	    	var endpoints = endpointsByElement[id];
	    	if (endpoints && endpoints.length) {
		    	for (var i = 0; i < endpoints.length; i++) {
		    		var c = endpoints[i].connections.length;
		    		if (c > 0) {
		    			for (var j = 0; j < c; j++) {
		    				var jpc = endpoints[i].connections[0];
		    				_removeElement(jpc.canvas);
		    				jpc.endpoints[0].removeConnection(jpc);
		    				jpc.endpoints[1].removeConnection(jpc);
		    			}
		    		}
		    	}
	    	}
	    },
	    
	    /*
	     Function: detachEverything
	     
	     Remove all Connections from all elements, but leaves Endpoints in place.
	     
	     Returns:
	     
	     	void
	     
	     See Also:
	     
	     	<removeAllEndpoints>
	     */
	    detachEverything : function() {
	    	for(var id in endpointsByElement) {	    	
		    	var endpoints = endpointsByElement[id];
		    	if (endpoints && endpoints.length) {
			    	for (var i = 0; i < endpoints.length; i++) {
			    		var c = endpoints[i].connections.length;
			    		if (c > 0) {
			    			for (var j = 0; j < c; j++) {
			    				var jpc = endpoints[i].connections[0];
			    				_removeElement(jpc.canvas);
			    				jpc.endpoints[0].removeConnection(jpc);
			    				jpc.endpoints[1].removeConnection(jpc);
			    			}
			    		}
			    	}
		    	}
	    	}
	    },
	    
	    extend : function(o1, o2) {
			return jsPlumb.CurrentLibrary.extend(o1, o2);
		},
	    
	    /*
	     Function: hide 
	     
	     Sets an element's connections to be hidden.
	     
	     Parameters:
	     
	     	el - either the id of the element, or a jQuery object for the element.
	     	
	     Returns:
	     
	     	void
	     */
	    hide : function(el) {
	    	_setVisible(el, "none");
	    },
	    
    	
    	
	    
	    /*
	     Function: makeAnchor
	     
	     Creates an anchor with the given params.
	     
	     Parameters:
	     
	     	x - the x location of the anchor as a fraction of the total width.  
	     	y - the y location of the anchor as a fraction of the total height.
	     	xOrientation - value indicating the general direction a connection from the anchor should go in, in the x direction.
	     	yOrientation - value indicating the general direction a connection from the anchor should go in, in the y direction.
	     	xOffset - a fixed offset that should be applied in the x direction that should be applied after the x position has been figured out.  optional. defaults to 0. 
	     	yOffset - a fixed offset that should be applied in the y direction that should be applied after the y position has been figured out.  optional. defaults to 0.
	     	
	     Returns:
	     
	     	The newly created Anchor.
	     */
	    makeAnchor : function(x, y, xOrientation, yOrientation, xOffset, yOffset) {
	    	// backwards compatibility here.  we used to require an object passed in but that makes the call very verbose.  easier to use
	    	// by just passing in four/six values.  but for backwards compatibility if we are given only one value we assume it's a call in the old form.
	    	var params = {};
	    	if (arguments.length == 1) jsPlumb.extend(params, x);
	    	else {
	    		params = {x:x, y:y};
	    		if (arguments.length >= 4) {
	    			params.orientation = [arguments[2], arguments[3]];
	    		}
	    		if (arguments.length == 6) params.offsets = [arguments[4], arguments[5]];
	    	}
	    	return new Anchor(params);
	    },
	        
	    
	    /*
	     Function: repaint
	     
	     Repaints an element and its connections. This method gets new sizes for the elements before painting anything.
	     
	     Parameters:
	      
	     	el - either the id of the element or a jQuery object representing the element.
	     	
	     Returns:
	     
	     	void
	     	
	     See Also:
	     
	     	<repaintEverything>
	     */
	    repaint : function(el) {
	    	
	    	var _processElement = function(el) {
	    		var ele = _getElementObject(el);
		    	_draw(ele);
	    	};
	    	
	    	// TODO: support a jQuery result object too!
	    	
	    	// support both lists...
	    	if (typeof el =='object') {
	    		for (var i = 0; i < el.length; i++)
	    			_processElement(el[i]);
	    	} // ...and single strings.
	    	else _processElement(el);
	    },       
	    
	    /*
	     Function: repaintEverything
	     
	     Repaints all connections.
	     
	     Returns:
	     
	     	void
	     	
	     See Also:
	     
	     	<repaint>
	     */
	    repaintEverything : function() {
	    	for (var elId in endpointsByElement) {
	    		_draw(_getElementObject(elId));
	    	}
	    },
	    
	    /*	     
	     Function: removeAllEndpoints
	     
	     Removes all Endpoints associated with a given element.  Also removes all Connections associated with each Endpoint it removes.
	    
	     Parameters:
	     
	    	el - either an element id, or a jQuery object for an element.
	    	
	     Returns:
	     
	     	void
	     	
	     See Also:
	     
	     	<removeEndpoint>
	    */
	    removeAllEndpoints : function(el) {
	    	var elId = _getAttribute(el, "id");
	    	// first remove all Connections.
	    	jsPlumb.detachAll(elId);
	    	var ebe = endpointsByElement[elId];
	    	for (var i in ebe) {
			_removeElement(ebe[i].canvas);	    	
	    	}	    
	    	endpointsByElement[elId] = [];
	    },
	    
	    /*
	     Function: removeEndpoint
	     
	     Removes the given Endpoint from the given element.
	    
	     Parameters:
	     
	    	el - either an element id, or a jQuery object for an element.
	    	endpoint - Endpoint to remove.  this is an Endpoint object, such as would have been returned from a call to addEndpoint.
	    	
	    Returns:
	    
	    	void
	    	
	    See Also:
	    
	    	<removeAllEndpoints>
	    */
	    removeEndpoint : function(el, endpoint) {
	        var elId = _getAttribute(el, "id");
	    	var ebe = endpointsByElement[elId];
	    	if (ebe) {
	    		if(_removeFromList(endpointsByElement, elId, endpoint))
	    			_removeElement(endpoint.canvas);
	    	}
	    },
	    
	    /*
	     Function: setAutomaticRepaint
	     
	     Sets/unsets automatic repaint on window resize.
	     
	     Parameters:
	     
	     	value - whether or not to automatically repaint when the window is resized.
	     	
	     Returns:
	     
	     	void
	     */
	    setAutomaticRepaint : function(value) {
	    	automaticRepaint = value;
	    },
	    
	    /*
	     Function: setDefaultNewCanvasSize
	     
	     Sets the default size jsPlumb will use for a new canvas (we create a square canvas so one value is all that is required).  
	     This is a hack for IE, because ExplorerCanvas seems to need for a canvas to be larger than what you are going to draw on 
	     it at initialisation time.  The default value of this is 1200 pixels, which is quite large, but if for some reason you're 
	     drawing connectors that are bigger, you should adjust this value appropriately.
	     
	     Parameters:
	     
	     	size - The default size to use. jsPlumb will use a square canvas so you need only supply one value.
	     	
	     Returns:
	     
	     	void
	     */
	    setDefaultNewCanvasSize : function(size) {
	    	DEFAULT_NEW_CANVAS_SIZE = size;    	
	    },
	    
	    /*
	     Function: setDraggable
	     
	     Sets whether or not a given element is draggable, regardless of what any plumb command may request.
	     
	     Parameters:
	      
	      	el - either the id for the element, or a jQuery object representing the element.
	      	
	     Returns:
	     
	      	void
	     */
	    setDraggable: _setDraggable, 
	    
	    /*
	     Function: setDraggableByDefault
	     
	     Sets whether or not elements are draggable by default.  Default for this is true.
	     
	     Parameters:
	     	draggable - value to set
	     	
	     Returns:
	     
	     	void
	     */
	    setDraggableByDefault: function(draggable) {
	    	_draggableByDefault = draggable;
	    },
	    
	    setDebugLog: function(debugLog) {
	    	log = debugLog;
	    },
	    
	    /*
	     Function: setRepaintFunction
	     
	     Sets the function to fire when the window size has changed and a repaint was fired.
	     
	     Parameters:	     
	     	f - Function to execute.
	     	
	     Returns:	     
	     	void
	     */
	    setRepaintFunction : function(f) {
	    	repaintFunction = f;
	    },
	        
	    /*
	     Function: show	     
	     
	     Sets an element's connections to be visible.
	     
	     Parameters:	     
	     	el - either the id of the element, or a jQuery object for the element.
	     	
	     Returns:
	     	void	     
	     */
	    show : function(el) {
	    	_setVisible(el, "block");
	    },
	    
	    /*
	     Function: sizeCanvas
	     
	     Helper to size a canvas. You would typically use this when writing your own Connector or Endpoint implementation.
	     
	     Parameters:
	     	x - [int] x position for the Canvas origin
	     	y - [int] y position for the Canvas origin
	     	w - [int] width of the canvas
	     	h - [int] height of the canvas
	     	
	     Returns:
	     	void	     
	     */
	    sizeCanvas : function(canvas, x, y, w, h) {
	    	if (canvas) {
		        canvas.style.height = h + "px"; canvas.height = h;
		        canvas.style.width = w + "px"; canvas.width = w; 
		        canvas.style.left = x + "px"; canvas.style.top = y + "px";
	    	}
	    },
	    
	    /**
	     * gets some test hooks.  nothing writable.
	     */
	    getTestHarness : function() {
	    	return {
	    		endpointCount : function(elId) {
	    			var e = endpointsByElement[elId];
	    			return e ? e.length : 0;
	    		},
	    		
	    		findIndex : _findIndex
	    	};	    	
	    },
	    
	    /**
	     * Toggles visibility of an element's connections. kept for backwards compatibility
	     */
	    toggle : _toggleVisible,
	    
	    /*
	     Function: toggleVisible
	     
	     Toggles visibility of an element's connections. 
	     
	     Parameters:
	     	el - either the element's id, or a jQuery object representing the element.
	     	
	     Returns:
	     	void, but should be updated to return the current state
	     */
	    //TODO: update this method to return the current state.
	    toggleVisible : _toggleVisible,
	    
	    /*
	     Function: toggleDraggable
	     
	     Toggles draggability (sic) of an element's connections. 
	     
	     Parameters:
	     	el - either the element's id, or a jQuery object representing the element.
	     	
	     Returns:
	     	The current draggable state.
	     */
	    toggleDraggable : _toggleDraggable, 
	    
	    /*
	     Function: unload
	     
	     Unloads jsPlumb, deleting all storage.  You should call this from an onunload attribute on the <body> element
	     
	     Returns:
	     	void
	     */
	    unload : function() {
	    	delete endpointsByElement;
			delete offsets;
			delete sizes;
			delete floatingConnections;
			delete draggableStates;		
	    },
	    
	    /*
	     Function: wrap
	     Helper method to wrap an existing function with one of your own.  This is used by the various
	     implementations to wrap event callbacks for drag/drop etc; it allows jsPlumb to be
	     transparent in its handling of these things.  If a user supplies their own event callback,
	     for anything, it will always be called.
	     Parameters:
	     	
	     */
	    wrap : _wrap
	};

})();