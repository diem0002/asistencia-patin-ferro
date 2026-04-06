import { useState, useEffect } from 'react';
import { db } from '../../lib/firebase';
import { collection, query, where, getDocs, setDoc, doc, deleteDoc } from 'firebase/firestore';
import { BarChart3, CreditCard, Check, X, AlertCircle } from 'lucide-react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { es } from 'date-fns/locale';

export default function ReportesPage() {
    const [grupos, setGrupos] = useState([]);
    const [selectedGrupo, setSelectedGrupo] = useState('');
    const [reportData, setReportData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [currentMonth, setCurrentMonth] = useState(new Date());

    useEffect(() => {
        async function fetchGrupos() {
            // Need valor_cuota to register payments
            const q = query(collection(db, 'grupos'), where('activo', '==', true));
            const snapshot = await getDocs(q);
            const gruposData = snapshot.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.nombre.localeCompare(b.nombre));
            setGrupos(gruposData);
        }
        fetchGrupos();
    }, []);

    useEffect(() => {
        if (!selectedGrupo) {
            setReportData([]);
            return;
        }
        fetchReport();
    }, [selectedGrupo, currentMonth]);

    async function fetchReport() {
        setLoading(true);
        try {
            // 1. Get all students in group
            const relQ = query(collection(db, 'alumnos_grupos'), where('grupo_id', '==', selectedGrupo));
            const relSnap = await getDocs(relQ);
            const alumnoIdsInGroup = relSnap.docs.map(d => d.data().alumno_id);

            // 2. Get attendance for THIS month (needed scope variables)
            const startStr = startOfMonth(currentMonth).toISOString().split('T')[0];
            const endStr = endOfMonth(currentMonth).toISOString().split('T')[0];

            let alumnos = [];
            if (alumnoIdsInGroup.length > 0) {
                const alumnosQ = query(collection(db, 'alumnos'), where('activo', '==', true));
                const alumnosSnap = await getDocs(alumnosQ);
                alumnos = alumnosSnap.docs
                    .map(doc => ({ id: doc.id, ...doc.data() }))
                    .filter(a => alumnoIdsInGroup.includes(a.id))
                    .filter(a => {
                        if (!a.fecha_inicio) return true;
                        return a.fecha_inicio <= endStr;
                    })
                    .sort((a, b) => {
                         const nombreA = (a.apellido || a.nombre || '').toLowerCase();
                         const nombreB = (b.apellido || b.nombre || '').toLowerCase();
                         return nombreA.localeCompare(nombreB);
                    });
            }

            // 2. Get attendance for THIS month
            const asistenciasQ = query(
                collection(db, 'asistencias'),
                where('grupo_id', '==', selectedGrupo),
                where('fecha', '>=', startStr),
                where('fecha', '<=', endStr)
            );
            const asistenciasSnap = await getDocs(asistenciasQ);
            const asistencias = asistenciasSnap.docs.map(d => d.data());

            // 3. Get Payments for THIS month
            const mesStr = format(currentMonth, 'yyyy-MM-01');

            const pagosQ = query(
                collection(db, 'pagos'),
                where('mes', '==', mesStr)
            );
            const pagosSnap = await getDocs(pagosQ);
            const pagos = pagosSnap.docs.map(d => d.data());

            // 4. Process Data
            const stats = alumnos.map(alumno => {
                const records = asistencias.filter(a => a.alumno_id === alumno.id);
                const totalClases = records.length;
                const presentes = records.filter(a => a.presente).length;
                const ausentes = totalClases - presentes;
                const porcentaje = totalClases > 0 ? Math.round((presentes / totalClases) * 100) : 0;

                const pago = pagos.find(p => p.alumno_id === alumno.id);
                const estaPagado = pago?.pagado || false;

                return {
                    ...alumno,
                    totalClases,
                    presentes,
                    ausentes,
                    porcentaje,
                    estaPagado
                };
            });

            setReportData(stats);

        } catch (err) {
            console.error(err);
            alert('Error al generar reporte');
        } finally {
            setLoading(false);
        }
    }

    async function togglePago(alumnoId, currentState) {
        // Optimistic update
        setReportData(prev => prev.map(a =>
            a.id === alumnoId ? { ...a, estaPagado: !currentState } : a
        ));

        try {
            const mesStr = format(currentMonth, 'yyyy-MM-01');
            const pagoId = `${alumnoId}_${mesStr}`;
            const pagoRef = doc(db, 'pagos', pagoId);

            if (!currentState) {
                // Mark as PAID
                // Get Group Fee
                const grupo = grupos.find(g => g.id === selectedGrupo) || {};
                const montoCuota = grupo.valor_cuota || 0;

                await setDoc(pagoRef, {
                    alumno_id: alumnoId,
                    mes: mesStr,
                    pagado: true,
                    fecha_pago: new Date().toISOString(),
                    monto: montoCuota
                });

            } else {
                // Mark as UNPAID
                await deleteDoc(pagoRef);
            }

        } catch (error) {
            console.error(error);
            alert('Error al actualizar pago');
            fetchReport(); // Revert on error
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
                    <BarChart3 className="w-8 h-8 text-ferro-green" />
                    Reportes y Pagos
                </h1>

                {/* Month Selector */}
                <input
                    type="month"
                    value={format(currentMonth, 'yyyy-MM')}
                    onChange={(e) => {
                        const [y, m] = e.target.value.split('-');
                        setCurrentMonth(new Date(y, m - 1, 1));
                    }}
                    className="border p-2 rounded-md shadow-sm text-gray-700 bg-white"
                />
            </div>

            {/* Filters */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <label className="block text-sm font-medium text-gray-700 mb-2">Seleccionar Grupo</label>
                <select
                    value={selectedGrupo}
                    onChange={(e) => setSelectedGrupo(e.target.value)}
                    className="block w-full max-w-md rounded-md border-gray-300 shadow-sm focus:border-ferro-green focus:ring-ferro-green py-2 px-3 border"
                >
                    <option value="">-- Selecciona un grupo --</option>
                    {grupos.map(g => (
                        <option key={g.id} value={g.id}>{g.nombre}</option>
                    ))}
                </select>
                {selectedGrupo && (
                    <p className="mt-2 text-sm text-gray-500">
                        Cuota del grupo: <span className="font-semibold text-gray-900">
                            ${grupos.find(g => g.id === selectedGrupo)?.valor_cuota || 0}
                        </span>
                    </p>
                )}
            </div>

            {/* Table */}
            {selectedGrupo && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    {loading ? (
                        <div className="p-10 text-center text-gray-500">Generando reporte...</div>
                    ) : reportData.length === 0 ? (
                        <div className="p-10 text-center text-gray-500">No hay alumnos en este grupo.</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Alumno</th>
                                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Asistencia Mes</th>
                                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Estado de Pago</th>
                                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">% Asistencia</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {reportData.map((row) => (
                                        <tr key={row.id} className="hover:bg-gray-50">
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm font-medium text-gray-900">{row.apellido}, {row.nombre}</div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-500">
                                                <span className="font-bold text-gray-900">{row.presentes}</span> / {row.totalClases}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-center text-sm">
                                                <button
                                                    onClick={() => togglePago(row.id, row.estaPagado)}
                                                    className={`
                                                    inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold shadow-sm transition-all
                                                    ${row.estaPagado
                                                            ? 'bg-green-100 text-green-700 hover:bg-green-200 border border-green-200'
                                                            : 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'}
                                                `}
                                                >
                                                    {row.estaPagado ? (
                                                        <>
                                                            <Check className="w-3.5 h-3.5" />
                                                            PAGADO
                                                        </>
                                                    ) : (
                                                        <>
                                                            <X className="w-3.5 h-3.5" />
                                                            NO PAGO
                                                        </>
                                                    )}
                                                </button>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-center">
                                                <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${row.porcentaje >= 75 ? 'bg-green-50 text-green-700' :
                                                    row.porcentaje >= 50 ? 'bg-yellow-50 text-yellow-700' :
                                                        'bg-gray-100 text-gray-600'
                                                    }`}>
                                                    {row.porcentaje}%
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
