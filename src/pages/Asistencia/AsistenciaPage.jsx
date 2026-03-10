import { useState, useEffect } from 'react';
import { db } from '../../lib/firebase';
import { collection, query, where, getDocs, doc, writeBatch, deleteDoc, setDoc, getDoc, orderBy } from 'firebase/firestore';
import { Calendar, UserCheck, Check, X, Save, AlertCircle, Trash2, CalendarOff } from 'lucide-react';
import { format } from 'date-fns';

export default function AsistenciaPage() {
    const [grupos, setGrupos] = useState([]);
    const [selectedGrupo, setSelectedGrupo] = useState('');
    const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));

    const [alumnos, setAlumnos] = useState([]);
    const [asistencia, setAsistencia] = useState({}); // { alumnoId: true/false }
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);
    const [eventoDia, setEventoDia] = useState(null); // Si es feriado o cancelado

    // 1. Fetch Grupos on mount
    useEffect(() => {
        async function fetchGrupos() {
            const q = query(collection(db, 'grupos'), where('activo', '==', true), orderBy('hora_inicio', 'asc'));
            const snapshot = await getDocs(q);
            setGrupos(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        }
        fetchGrupos();
    }, []);

    // 2. Fetch Alumnos, Asistencias & Eventos when Grupo or Date changes
    useEffect(() => {
        if (!selectedGrupo) {
            setAlumnos([]);
            return;
        }

        async function fetchData() {
            setLoading(true);
            setMessage(null);
            setEventoDia(null);
            try {
                // A. Get Students in this Group
                const relQ = query(collection(db, 'alumnos_grupos'), where('grupo_id', '==', selectedGrupo));
                const relSnap = await getDocs(relQ);
                const alumnoIdsInGroup = relSnap.docs.map(d => d.data().alumno_id);

                let alumnosData = [];
                if (alumnoIdsInGroup.length > 0) {
                    const alumnosQ = query(collection(db, 'alumnos'), where('activo', '==', true));
                    const alumnosSnap = await getDocs(alumnosQ);
                    alumnosData = alumnosSnap.docs
                        .map(doc => ({ id: doc.id, ...doc.data() }))
                        .filter(a => alumnoIdsInGroup.includes(a.id))
                        .sort((a, b) => a.apellido.localeCompare(b.apellido));
                }

                // B. Get Existing Attendance
                const asistenciaQ = query(
                    collection(db, 'asistencias'),
                    where('grupo_id', '==', selectedGrupo),
                    where('fecha', '==', selectedDate)
                );
                const asistenciaSnap = await getDocs(asistenciaQ);

                // C. Get Events (Feriado/Cancelado)
                const eventoId = `${selectedGrupo}_${selectedDate}`;
                const eventoSnap = await getDoc(doc(db, 'agenda_eventos', eventoId));

                if (eventoSnap.exists()) {
                    setEventoDia({ id: eventoSnap.id, ...eventoSnap.data() });
                }

                setAlumnos(alumnosData);

                // Map existing attendance
                const asistenciaMap = {};
                if (!asistenciaSnap.empty) {
                    asistenciaSnap.docs.forEach(recordSnap => {
                        const record = recordSnap.data();
                        asistenciaMap[record.alumno_id] = record.presente;
                    });
                    setAsistencia(asistenciaMap);
                } else {
                    setAsistencia({});
                }

            } catch (error) {
                console.error('Error:', error);
                setMessage({ type: 'error', text: 'Error cargando datos.' });
            } finally {
                setLoading(false);
            }
        }

        fetchData();
    }, [selectedGrupo, selectedDate]);

    const toggleAsistencia = (alumnoId) => {
        setAsistencia(prev => ({
            ...prev,
            [alumnoId]: !prev[alumnoId]
        }));
    };

    const handleSave = async () => {
        if (!selectedGrupo || alumnos.length === 0) return;

        setSaving(true);
        try {
            const batch = writeBatch(db);

            alumnos.forEach(alumno => {
                const docId = `${alumno.id}_${selectedGrupo}_${selectedDate}`;
                const ref = doc(db, 'asistencias', docId);
                batch.set(ref, {
                    alumno_id: alumno.id,
                    grupo_id: selectedGrupo,
                    fecha: selectedDate,
                    presente: asistencia[alumno.id] || false,
                });
            });

            await batch.commit();

            setMessage({ type: 'success', text: 'Asistencia guardada correctamente.' });
            setTimeout(() => setMessage(null), 3000);

        } catch (error) {
            console.error('Error saving:', error);
            setMessage({ type: 'error', text: 'Error al guardar.' });
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteDay = async () => {
        if (!window.confirm('¿Seguro que quieres BORRAR este día? Se eliminarán todas las asistencias registradas.')) return;

        setSaving(true);
        try {
            const batch = writeBatch(db);

            const asistenciaQ = query(
                collection(db, 'asistencias'),
                where('grupo_id', '==', selectedGrupo),
                where('fecha', '==', selectedDate)
            );
            const asistenciaSnap = await getDocs(asistenciaQ);
            asistenciaSnap.docs.forEach(d => batch.delete(d.ref));

            const eventoId = `${selectedGrupo}_${selectedDate}`;
            batch.delete(doc(db, 'agenda_eventos', eventoId));

            await batch.commit();

            setAsistencia({});
            setEventoDia(null);
            setMessage({ type: 'success', text: 'Día eliminado correctamente.' });
            setTimeout(() => setMessage(null), 3000);
        } catch (error) {
            console.error('Error deleting:', error);
            setMessage({ type: 'error', text: 'Error al eliminar día.' });
        } finally {
            setSaving(false);
        }
    };

    const handleMarkEvent = async (tipo) => {
        if (!window.confirm(`¿Marcar este día como ${tipo}?`)) return;

        setSaving(true);
        try {
            const batch = writeBatch(db);

            // 1. Create Event
            const eventoId = `${selectedGrupo}_${selectedDate}`;
            const eventoRef = doc(db, 'agenda_eventos', eventoId);
            batch.set(eventoRef, {
                grupo_id: selectedGrupo,
                fecha: selectedDate,
                tipo: tipo,
                descripcion: tipo === 'FERIADO' ? 'Feriado Nacional / Local' : 'Clase Cancelada'
            });

            // 2. Delete attendance records
            const asistenciaQ = query(
                collection(db, 'asistencias'),
                where('grupo_id', '==', selectedGrupo),
                where('fecha', '==', selectedDate)
            );
            const asistenciaSnap = await getDocs(asistenciaQ);
            asistenciaSnap.docs.forEach(d => batch.delete(d.ref));

            await batch.commit();

            setAsistencia({});
            setEventoDia({ tipo });

            setMessage({ type: 'success', text: `Día marcado como ${tipo}.` });
        } catch (error) {
            console.error('Error marking event:', error);
            setMessage({ type: 'error', text: 'Error al registrar evento.' });
        } finally {
            setSaving(false);
        }
    }


    return (
        <div className="space-y-6 max-w-4xl mx-auto">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
                    <UserCheck className="w-8 h-8 text-ferro-blue" />
                    Tomar Asistencia
                </h1>

                {/* Date Picker */}
                <div className="flex items-center gap-2 bg-white p-2 rounded-lg border shadow-sm">
                    <Calendar className="w-5 h-5 text-gray-500" />
                    <input
                        type="date"
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        className="outline-none text-gray-700 font-medium"
                    />
                </div>
            </div>

            {/* Helper / Status Message */}
            {message && (
                <div className={`p-4 rounded-lg flex items-center gap-2 ${message.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                    <AlertCircle className="w-5 h-5" />
                    {message.text}
                </div>
            )}

            {/* Group Selector */}
            <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-200">
                <label className="block text-sm font-medium text-gray-700 mb-2">Seleccionar Grupo</label>
                <select
                    value={selectedGrupo}
                    onChange={(e) => setSelectedGrupo(e.target.value)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-ferro-blue focus:ring-ferro-blue py-3 px-4 border text-lg"
                >
                    <option value="">-- Selecciona un grupo --</option>
                    {grupos.map(g => (
                        <option key={g.id} value={g.id}>
                            {g.nombre} ({g.hora_inicio?.slice(0, 5)}hs)
                        </option>
                    ))}
                </select>
            </div>

            {/* Students List */}
            {selectedGrupo && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    {/* Header with Tools */}
                    <div className="p-4 bg-gray-50 border-b flex flex-col sm:flex-row justify-between items-center gap-4">
                        <span className="font-semibold text-gray-700">Listado de Alumnos ({alumnos.length})</span>

                        <div className="flex gap-2">
                            {eventoDia ? (
                                <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-sm font-bold border border-yellow-200">
                                    {eventoDia.tipo}
                                </span>
                            ) : (
                                <>
                                    <button onClick={() => handleMarkEvent('FERIADO')} className="text-xs bg-white border border-gray-300 text-gray-600 px-3 py-1 rounded hover:bg-gray-50">
                                        Marcar Feriado
                                    </button>
                                    <button onClick={() => handleMarkEvent('CANCELADO')} className="text-xs bg-white border border-gray-300 text-gray-600 px-3 py-1 rounded hover:bg-gray-50">
                                        Cancelar Clase
                                    </button>
                                </>
                            )}

                            {(Object.keys(asistencia).length > 0 || eventoDia) && (
                                <button
                                    onClick={handleDeleteDay}
                                    title="Borrar todos los datos de este día"
                                    className="p-2 text-red-500 hover:bg-red-50 rounded transition"
                                >
                                    <Trash2 className="w-5 h-5" />
                                </button>
                            )}
                        </div>
                    </div>

                    {loading ? (
                        <div className="p-10 text-center text-gray-500">Cargando alumnos...</div>
                    ) : alumnos.length === 0 ? (
                        <div className="p-10 text-center text-gray-500">
                            No hay alumnos asignados a este grupo.
                            <br />
                            <a href="/alumnos" className="text-ferro-blue hover:underline">Ir a asignar alumnos</a>
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-100">
                            {/* Overlay for Event */}
                            {eventoDia && (
                                <div className="p-8 text-center bg-yellow-50/50">
                                    <CalendarOff className="w-12 h-12 text-yellow-500 mx-auto mb-2" />
                                    <h3 className="text-lg font-bold text-gray-700">Día marcado como {eventoDia.tipo}</h3>
                                    <p className="text-gray-500">No se tomará asistencia.</p>
                                    <button onClick={handleDeleteDay} className="mt-4 text-sm text-red-600 underline">
                                        Restaurar día normal
                                    </button>
                                </div>
                            )}

                            {!eventoDia && alumnos.map(alumno => {
                                const isPresent = asistencia[alumno.id] || false;
                                return (
                                    <div key={alumno.id} className="p-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                                        <div className="flex items-center gap-4">
                                            <div className={`w-2 h-10 rounded-full ${isPresent ? 'bg-ferro-green' : 'bg-gray-200'}`}></div>
                                            <div>
                                                <p className="font-medium text-gray-900 text-lg">{alumno.apellido}, {alumno.nombre}</p>
                                                <p className="text-sm text-gray-500">Presente: {isPresent ? 'SÍ' : 'NO'}</p>
                                            </div>
                                        </div>

                                        <button
                                            onClick={() => toggleAsistencia(alumno.id)}
                                            className={`
                                        flex items-center gap-2 px-6 py-2 rounded-full font-bold transition-all transform active:scale-95
                                        ${isPresent
                                                    ? 'bg-ferro-green text-white shadow-md hover:bg-green-700'
                                                    : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                                                }
                                    `}
                                        >
                                            {isPresent ? (
                                                <>
                                                    <Check className="w-5 h-5" />
                                                    Presente
                                                </>
                                            ) : (
                                                <>
                                                    <X className="w-5 h-5" />
                                                    Ausente
                                                </>
                                            )}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Footer Actions */}
                    {alumnos.length > 0 && !eventoDia && (
                        <div className="p-6 bg-gray-50 border-t flex justify-end">
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="bg-ferro-blue text-white px-8 py-3 rounded-lg font-bold shadow-lg hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {saving ? (
                                    'Guardando...'
                                ) : (
                                    <>
                                        <Save className="w-5 h-5" />
                                        Guardar Asistencia
                                    </>
                                )}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
