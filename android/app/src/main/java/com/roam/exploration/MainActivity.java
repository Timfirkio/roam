package com.roam.exploration;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) { registerPlugin(RideTrackingPlugin.class); super.onCreate(state); }
}
