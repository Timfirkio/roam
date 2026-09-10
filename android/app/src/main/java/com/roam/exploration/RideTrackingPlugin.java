package com.roam.exploration;

import android.content.Intent;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "RideTracking")
public class RideTrackingPlugin extends Plugin {
  @PluginMethod public void start(PluginCall call) { ContextCompat.startForegroundService(getContext(), new Intent(getContext(), RideTrackingService.class).setAction(RideTrackingService.START)); call.resolve(); }
  @PluginMethod public void stop(PluginCall call) { getContext().startService(new Intent(getContext(), RideTrackingService.class).setAction(RideTrackingService.STOP)); call.resolve(); }
}
