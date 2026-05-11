import React, { useEffect, useRef } from 'react';
import Highcharts from 'highcharts';
import drilldown from 'highcharts/modules/drilldown';

drilldown(Highcharts);

export default function HighchartsDrilldown({ data }) {
  const ref = useRef(null);

  useEffect(() => {
     if(!data) return;
     
     const grouped = {};
     
     data.forEach(row => {
        const bay = row.bay_name;
        if(!grouped[bay]) grouped[bay] = [];
        grouped[bay].push([
           new Data(row.time).getTime(),
           row.y_axis,
        ]);
     });
  });
  
  const barData = Object.keys(grouped).map(bay => {
    const vals = grouped[bay].map(d => d[1]);
    const avg = vals.reduce((a,b) => a + b, 0) / vals.length;
    return {
      name: bay,
      y: avg,
      drilldown: bay,
    };
  });
  
  const drilldownSeries = Object.keys(grouped).map(bay => ({
    id: bay,
    type: 'line',
    data: grouped[bay],
  }));
  
  Highcharts.chart(ref.current, {
    chart: { type: 'column' },
    title: { text: 'Bay Overview' },
    xAxis: { type: 'category' },
    
    series: [{
      name: 'Bays',
      data: barData,
    }],
    
    drilldown: {
      series: drilldownSeries,
    },
  }, [data]);
  
  return <div ref={ref} />;
}
